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

## 2026-09-01 — `docs/implementation-backlog.md` 14506 → 14521 (BF-55's owner gate cleared)

Fifteen lines recording the owner's approval to drop `oura_heartrate_user_updated`, and the
re-verification it was conditioned on — *"if we are not using it and you are sure its reversible"*.
Both conditions were checked against production rather than taken from the entry's 2026-08-30 table,
which is the point of the length: `idx_scan` and `idx_tup_read` are still 0 while the sibling index
on the same table shows 40,195 scans, and `getOuraTimeseriesDelta` has no caller in any of the three
places it is defined.

**The check caught a real mistake while this was written, and it is worth recording.** The cleared
gate was first written as a struck-through `~~**Gate: owner**~~` at the head of its bullet, and
`check-backlog-pointers.js` failed it: a `Gate:` in field position is read as a field whatever
decoration is around it, so the strike-through would have left the entry parked while reading as
cleared. The field is now removed and the clearance narrated in prose that does not begin with the
word. That is the inverse of LB-18's lesson — there a cleared gate was narrated but never struck;
here striking it in place would have been just as wrong.

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
## 2026-08-26 — backlog → 12164, `projectOverview.md` → 8050, `docs/agents/state/tuning.md` 218 → 235 (the HR-tile and pacing follow-ups)

*(Absolute figures are from the final rebase; other PRs raised the same two lines while this branch was open, so the deltas this branch is responsible for are **+83** on the backlog and **+9** on `projectOverview.md`.)*

One new entry (**TN-17**, Activity as a pace-to-goal score) and two amendments that are longer than
the entry.

**TN-13's amendment carries a reconciliation, and that is what the lines buy.** The pillar review
quoted resting HR at **+0.557** against the check-in; measured raw, it is **+0.129**. Both are right
— one is the baseline-relative contributor score, one is bare bpm — and without the amendment saying
so, the next session finds a contradiction between two of its own documents and re-runs the whole
lookback to resolve it. It also records that **4 `provisional: true` rows** (score pinned at the
placeholder 50) drag that correlation from −0.553 to −0.395, which is a trap for any future query
against `readiness_contributors`.

**TN-17 is long because the mechanic is fine and the reason not to ship it yet is arithmetic.** The
owner's median day is 4,649 steps against a 7,000 goal reached on 32% of days, so a paced score reads
red from mid-morning most days. An entry that said only "build pacing" would ship a tile that tells
the owner they are failing — and the entry has to carry the numbers, or that gets rediscovered on
the device.

**TN-3a gains a shipped-notice** rather than being deleted: the table is live, the back-fill is not,
so it keeps a `Keep:` line instead of leaving the queue looking finished.

**The baton was compacted in the same pass** (241 → 234 before the raise). Its 16 net lines are three
traps a successor would otherwise walk into — `perceived_recovery` runs 1 = best … 5 = worst,
`readiness_contributors` carries `provisional: true` rows pinned at 50, and `step_live_windows` is
empty — plus the note that TN-3a's queue entry lagged the database by two days, which is the general
lesson: check production before trusting an entry's state.

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

## 2026-08-26 — `docs/implementation-backlog.md` raised, 12195 → 12215 (BF-35 corrected twice)

The owner rejected the generate-on-second-log lever — *"that means the first person wouldnt get an
image right? We always want an image?"* — and is right: the first log is the moment the row is being
looked at, and with one user "the first person" is always them. Withdrawn rather than deleted, so it
is not re-proposed.

Measuring the replacement corrected two things this entry had wrong. **`barcode` is 3 items and the
OFF name search is 3**, so the free route covers 3% of the catalogue, not "most rows" as claimed.
And **`source` cannot distinguish a photo scan from a typed description** — both write `'ai'` — so
the 203 that would route to generation cannot be split after the fact, and the routing has to happen
where the code still knows whether an image was in hand.

Both are the kind of thing that reads as a detail and re-scopes the work.

## 2026-08-26 — `docs/implementation-backlog.md` raised, 12298 → 12324 (BF-36)

One entry, filed to close an orphaned finding: the entries runaway limit blocked PR #527 for a
condition that PR neither caused nor fixed, and it was flagged in conversation and never written
down. Per **No orphaned findings**, that made it a dropped finding.

The entry argues the targeting rather than the threshold — the check should fail a PR that **adds**
an entry and merely note it for one that does not, using the attribution the doc-size ratchet a few
lines above already performs. It also records why the two obvious alternatives are worse: raising
the limit defers the collision and makes the eventual sweep bigger, and warn-only is how the
directory reached 198 files.
## 2026-08-26 — `projectOverview.md` → 8060, backlog → 12123, Q-280

The Current Status paragraph for the batch-upsert duplicate-collapse sweep. **Absolute figures are
from the final merge with `main`** — #530 raised both lines while this branch was open, so the deltas
this branch is responsible for are **+10** on `projectOverview.md` and **−41** on the backlog (two
completed entries removed, Q-280 and Q-518, against the amendments added). Trimmed from 16 lines to
10 before raising: the mechanism, the eight-site count and the per-site-strategy caveat are the parts
a session needs before touching a batch write; the full site table, the premise corrections and the
mutation proof live in `docs/overview/entries/2026-08-26-fix-batch-upsert-duplicate-collapse.md`.
Also carries the two owner decisions of 2026-08-26 (readiness history recomputed rather than frozen;
Coach mid-program swap to be restricted), which are pointers to Q-403 and the Body Battery tuning
section rather than the decisions themselves.

## 2026-08-26 — backlog → 12304 (+21), `projectOverview.md` → 8071 (+11), Q-528 + LA-33

Net of two opposing changes: **−36** removing the completed Q-528 entry, **+45** filing LA-33 (the
three shared-line ledgers that conflict on every pair of PRs), **+12** amending TN-1's sequencing
note, which said to batch it with Q-528 and no longer applies.

LA-33 is long because the argument is a measurement, not an opinion — four merge races in 35
minutes, which three files they landed in, and the precedent that the same shape was already fixed
once here (the session journal going one-file-per-entry). An entry that said only "the baselines
conflict a lot" would be re-litigated by whoever picks it up.

`projectOverview.md`'s eleven lines are the Current Status paragraph. It carries the two defects the
entry did **not** name, because a session reading only the entry would fix one of three; the
reproduction detail and the not-batched-with-TN-1 reasoning are in
`docs/overview/entries/2026-08-26-fix-daily-summary-replace-guard.md`.

## 2026-08-26 — backlog → 12348 (+44), `projectOverview.md` → 8082 (+11), BF-35

Three amendments to BF-35, all of them corrections rather than additions, made before implementing it
and verified against the code rather than reasoned about:

- Its closing section still concluded **"never generate one"** — the pre-decision recommendation the
  owner overruled the same day. A session skimming to the measured-evidence block would have built
  the opposite of what was decided.
- It sized the feature against **database storage**. `food_items` is a synced domain, so the binding
  constraint is outbox and on-device payload — the exact axis confusion `meal-image.ts` warns about
  by name, where `users.avatar`'s harmless 5 MB becomes "the largest single regression the sync
  engine has taken" if copied to a synced table.
- **"The scan photo is already in the request, so keeping it is free"** is half true: the request
  carries 1024 px because the model has to read the label, against a 128 px thumbnail — ~64× the
  pixels. The fix lives in `capture-step.tsx`, which is Lane B, so route 2 is split across lanes.

The pointer table also moves (migration 227 → 229, SQLite v29 → v30), which is two lines of the
count and is what `check-backlog-pointers.js` enforces.

The remaining fifteen are BF-35's `Keep:` line. It stays queued because only the engine half of two
of its three routes shipped: the render and route 2's client downscale are Lane B, route 3 is
unbuilt, and the search route's deliberate omission needed its reason recorded (60 products, so a
thumbnail each is 60 requests per search). A `Keep:` that says only "partly done" sends the next
session to re-derive all of that.

## 2026-08-26 — `projectOverview.md` → 8084 (+2), LB-15

Two lines, appended to the existing food-image paragraph rather than opening a new Current Status
block: a small fix on the same surface does not need its own section, and the index is kept lean on
purpose.

The backlog is **not** re-ratcheted in this PR even though removing LB-15 took it 27 lines below its
baseline. Tightening a shared file that every agent's open branch also edits would fail those PRs for
no benefit — the ratchet exists to stop growth going unnoticed, and any growth still shows in a diff.
Deliberate, so a later sweep does not read the slack as an oversight.

## 2026-08-26 — `projectOverview.md` → 8093 (+11), BF-19

The Current Status paragraph for app-load measurement. Eleven lines because three of them are
decisions a later session would otherwise reverse on sight: the cold/warm split (it looks like a
facet and is the whole report), telemetry deliberately bypassing the outbox (it looks like a missed
offline-first rule and is a choice), and `buildId` baked into the bundle rather than stamped
server-side (which looks like the harder option and is the only correct one, because a stale shell is
the case being measured). The full reasoning, the mutation proof and the lane note are in
`docs/overview/entries/2026-08-26-feat-app-load-metrics.md`.

The backlog shrank again (BF-19 removed, 61 lines) and is again left at its recorded number rather
than re-ratcheted, for the reason given above on 2026-08-26.

## 2026-08-26 — `projectOverview.md` → 8105 (+12), Q-403

The Current Status paragraph for the Coach swap. Twelve lines because two of them exist to stop the
next session repeating a mistake this one made: the recommendation given to the owner (gate the swap
on injury) was **wrong**, and only verifying it before building caught that — `injurySafeAlternatives`
already substitutes mid-workout without touching the program, so gating a permanent edit on injury
would have been the worst of the options. A status line that recorded only the outcome would leave
the next reader free to re-derive the discarded recommendation from the same reasoning.

The rest is the decision itself, which is neither of the shapes the entry had carried since
2026-08-18 and would otherwise be re-litigated from the entry's older prose.

## 2026-08-26 — `projectOverview.md` → 8116 (+11), LA-33 + LA-22

**The first raise made under the new scheme, and it is one file.** `docs/doc-size/projectOverview.md.size`
holds a number and nothing else, so a second PR raising a different document's baseline now conflicts
with nothing here — which is the whole point of the split.

Eleven lines for two entries because both carry a decision that would otherwise be re-derived: the
size ledger's conflict was structural rather than a discipline problem (every PR edits the same two
lines whether or not it is about the same doc), and E2E's gate must **always report** rather than use
a `paths:` filter, because a required check that never reports blocks a non-UI PR forever. The line
that earns its place most is the outstanding owner action — E2E is not required until branch
protection says so, and nothing in this repository can make that true.

## 2026-08-26 — `docs/implementation-backlog.md` 12348 → 12525 (+177 net; this branch added 332)

Five entries from the Colmi ring work (PS-8): **PS-9** raw accelerometer, **PS-10** ring gestures,
and the three queued at the top as tomorrow's device testing — **PS-11** first overnight sync,
**PS-12** comparison baseline, **PS-13** the heart-rate log's dropped continuation packets.

Raised rather than trimmed because this is the index doing its job: PS-11/12/13 are a device-gated
acceptance test written the evening before it runs, and the detail in them is the part that stops it
being re-derived at the bench. They leave the queue when they are done, which is when this number
comes back down.
## 2026-08-26 — `projectOverview.md` 8116 → 8124 (+8), Q-501

Eight lines for one Current Status block: the readiness contributors now record the input they were
scored from, which is what lets a stored score be re-derived from itself rather than from today's
summary. Most of the material went to the journal entry — the block links it rather than restating
it. What stays here is the pair of readings that changes how the next session interprets a
disagreement (self-consistent = the inputs were rewritten, inconsistent = the model moved) and the
one number worth carrying forward: the entry's own "5 of 33" was wrong, and the un-re-derivable
population is **7** of 42.

## 2026-08-26 — `docs/agents/state/implementation-lane-a.md` 178 → 199 (+21), the tenth Lane A session

Twenty-one lines net after trimming three sections that had become narrative — the closed database
reclaim, the queue-tool mis-reports, and the owner-waiting list, which had four answered items still
on it. What replaces them is state a successor cannot re-derive: which entries are gated and on whom
(the owner said on this date to leave those for later, so a successor reading the queue top-down
would otherwise start one), the two traps this session hit, and the doc-size ledger's own new shape
after LA-33 — the old trap named a JSON file that no longer exists.

A baton is state, not accretion, and this one is at the length where the next session should be
rewriting rather than editing.

## 2026-08-26 — `projectOverview.md` 8124 → 8128 (+4), Q-526

Four lines, after folding Q-526's status block into Q-501's rather than adding a second. They are one
finding read two ways — every score now stores the breakdown it was made of — and two adjacent blocks
saying that separately would have cost eleven lines to say it worse. The measurement worth keeping in
the index is the one that changes what a reader concludes from a stored row: both fixes are
**forward-only**, so a day before 2026-08-26 is not merely unchecked but uncheckable.

## 2026-08-26 — `projectOverview.md` 8128 → 8138 (+10), Q-519 engine half

Ten lines, and the two that earn the rest are the ⚠️ ones: **no UI exists yet**, so a session reading
"manual bedtime shipped" would otherwise go looking for a control that is not there, and **the local
column is not device-verified**, which is the gate the Canonical Runtime rule requires stated
somewhere a session reads before starting.

The middle of the block is the design reversal rather than the feature. An entry proposed writing the
remembered bedtime into `sleep_start`; the audit it commissioned found that turns a measured 3 h night
into 10 h at 35%. Recording only "manual bedtime shipped" would leave the next session free to
re-derive the rejected design as the obvious one — the numbers are what make it not obvious.

## 2026-08-26 — `docs/agents/state/implementation-lane-a.md` 199 → 203 (+4), late-session refresh

Net four after trimming two traps that had become narrative. What is added is the sharpest thing this
session learned and the one a successor cannot re-derive from the queue: **an entry's own stated
invariant is a claim, not a fact.** Q-519 said duration and efficiency are stored columns rather than
derived from the span, and warned what would happen if anything derived them — `aggregateNight`
already did, and building the entry as written would have turned a measured 3 h night into 10 h at
35%. The instruction that follows is the reusable half: when an entry names the assumption its design
rests on, that sentence is the thing to go and check.

## 2026-08-27 — `docs/implementation-backlog.md` 12525 → 12600 (+75), PS-14 and the ring queue

Two additions, both queue material rather than narrative.

The first is PS-11/12/13, the Colmi R09 follow-ups: the overnight-sync verification, the
three-device comparison baseline, and the heart-rate log's dropped continuation packets. They are
long because the ring is undocumented — each entry has to carry the byte layout or the command
shape it depends on, and there is no reference doc to point at instead.

The second is PS-14, an intermittent nutrition e2e failure found from CI rather than from the app.
It carries a hypothesis and a proposed patch but no reproduction, which is deliberate: an entry that
says "flaky, look into it" is one nobody can start, and the mechanism is the part that would
otherwise have to be re-derived from three run logs that expire.

Raised to 12650 on the merge, not 12600 as first written: #570 raised the same baseline to 12563
in parallel, and the two sets of entries stack to 12634. Two PRs raising one document is the one
case where these files still conflict, and it is the correct case — they genuinely disagree about
the number, and the answer is neither side but the sum of what both added.
## 2026-08-27 — `docs/implementation-backlog.md` raised (BF-41, the clinical-import shape)

The owner is about to send RMR, DEXA and blood results together and asked for an endpoint plus
document scanning. Three entries already covered those separately — BF-33 (engine shipped), BF-2 and
BF-1 — at three different stages, and nothing said they are the same shape.

BF-41 is that statement: **typed storage per result, one shared upload → crop → extract → confirm
pipeline**. The length is two arguments worth not re-deriving. Storage stays typed because BF-2's
calibration and BF-33's precedence both do arithmetic on named columns, which JSONB makes hard. And
**the app's crop-before-upload step is still required even though the owner scrubs the file by hand**
— those are two different redactions, and conflating them is how the security half gets skipped.

## 2026-08-27 — `docs/implementation-backlog.md` raised (the measurements arrived)

22 lines (12635 → 12657 after merging main): four ⚑ pointers, one each on BF-41, BF-33, BF-2 and BF-1, into the new
`docs/clinical-baseline-2026-08-27.md`. The owner's DEXA, RMR and blood results landed in a session
thread, and every one of those four entries was filed *waiting on exactly these numbers* — so the
values go in a reference doc and each entry gets the one line that changes what it should be built as.

The lines are not summaries. Each carries the finding that would otherwise be re-derived: BF-2 now
has its first calibration pair (DEXA 28.5 % vs Renpho 25.3 %) **and the warning not to bake the 3.2
into a constant**, because one pair cannot separate an offset from a ratio. BF-33 records that
Cunningham runs 156 kcal high even on the owner's own DEXA lean mass — so the error is not body
composition and a measured value must override rather than blend. BF-1 records the five shape
questions a real 58-analyte panel answers that a described one could not.

## 2026-08-27 — `docs/implementation-backlog.md` raised (BF-42, and the owner promoting BF-2)

47 lines (12634 after merging main, which removed the shipped BF-40). Most of it is **BF-42**, filed from a question rather than a bug report: the owner asked
whether exercise calories add on to the RMR base correctly. They do — `computeActiveEnergy` is
net-of-rest and `calculateBaseline` refuses to multiply an activity factor in, both from Q-401. But
checking it surfaced that `energy-balance-service.ts` computes its **own** BMR and never reads the
measured RMR that BF-33 shipped, so the goal wizard and the Energy Balance card are about to disagree
about one person's resting rate — and that BMR is also the floor under the calibrated maintenance,
which for this owner sits 156 kcal above the measured value.

The entry is long because the floor is the half that gets missed: substituting the base and leaving
`Math.max(bmr, …)` alone would look correct and still clamp the calibration.

## 2026-08-27 — `docs/implementation-backlog.md` raised (BF-2 × BF-33 interact)

8 lines on BF-2 (12713 after merging main twice more). Found while working out what the owner's daily calorie targets actually become:
`personalRmr` re-scales a measurement's residual to today's fat-free mass, and the stored
`ffm_kg_at_test` is the DEXA's. Feed today's side an **uncorrected** scale reading and the two ends
come from different instruments — at the measured 3.2-point gap that is 53.56 kg against 51.46 kg,
which re-scales the measurement onto 45 kcal/day of lean mass that is not there. The order of the
two fixes is load-bearing and neither entry said so.

## 2026-08-27 — `projectOverview.md` 8138 → 8147 (+9), BF-24 ②

Nine lines for the nutrition energy card. Four of them are the feature; the rest are the part a
successor cannot re-derive from the diff — **the card derives no number of its own**, and the three
findings that put that rule there (Q-401's two budgets on one screen, Q-417's third one appearing the
moment a screen composed its own, Q-323's earned-scaled macro targets). A first draft of this card
called `budgetProvenance` internally and would have been the fourth; recording only "the energy block
now matches the mockup" leaves the next person free to do exactly that.

## 2026-08-27 — `docs/implementation-backlog.md` 12713 → 12728 (+15), Q-407's widget half

Fifteen lines on one entry, and they buy two things a successor cannot re-derive. First, **which half
of Q-407 shipped**: the entry describes a conversational redesign and a multi-select widget as one
item, and only the widget exists — a reader seeing "✅" against the heading would skip the larger
half. Second, **the catch**: `/api/coach/options` returns an empty list when there is no active
program, which is correct for the three program-backed sources and would have made a grocery picker
come back empty for a user who has not built a program yet. That is a nutrition question failing on a
training precondition, it was invisible until the new branches were placed, and the placement is the
whole fix.

## 2026-08-27 — `projectOverview.md` 8147 → 8156 (+9), Q-407's widget half

Nine lines, and the ⚠ is the one that has to be there: **Q-407's conversational half is untouched**.
The entry describes a seven-step wizard becoming a conversation *and* a multi-select widget as one
item; only the widget exists. A status line reading "Q-407 shipped" would have the next session skip
the larger half entirely.

The rest is the measurement that makes the change worth understanding rather than just noting — a
nine-option picker the model types out costs ~554 output tokens, and output is essentially all of
Coach's latency, which is why six curated lists became choice sources rather than staying literals
in a component.
## 2026-08-27 — `docs/implementation-backlog.md` raised (LB-23, LB-24 filed by Q-112a)

48 net lines (12760 after merging main twice, which added 36 of its own without needing a raise):
two
entries filed, minus Q-112a's own removal on shipping.

**LB-24 is the one worth the space.** Deleting `day-review-sheet.tsx` left
`workout-load-comparison-chart.tsx` with zero call sites and `/api/workout-load-history` with zero
client callers — and the obvious tidy-up is wrong, because Q-112c's plan names that route as one of
the series it reuses for the 7-day window. Without the entry the next dead-code sweep deletes work
Q-112c is about to need, or leaves it forever because nobody wrote down which. It records the
decision point (after Q-112d) and the fact that `invalidateWorkoutSummaries()` still prefix-clears
an inert key.

**LB-23** costs less and exists because an E2E comment already pointed at it: three sheets render an
`sr-only` `SheetTitle` and a visible `<h2>` carrying the same string, so the dialog's accessible name
is announced twice and `getByRole('heading')` is ambiguous. It names the fourth sheet that is *not* a
violator, so a sweep does not "fix" the one that is already right.

## 2026-08-27 — `docs/implementation-backlog.md` raised (LB-25 replaces the shipped Q-112b)

20 net lines (12780). Q-112b's four-line entry is gone; LB-25 is longer because it records **why**
the one stat it could not ship is not simply "add a stat".

Body temperature has no client-reachable source. `oura_daily.temperature_deviation` is the frozen
Cloud column the plan forbids; the live derived values (`oura_daily_summary.temp_mean_c` /
`temp_dev_c`) are returned by **no route** — `health-insight` reads `tempDevC` and feeds it to a
prompt, which is not a payload. They *are* in the local store, so a device-only local-first read
would work and would be unverifiable in `pnpm dev` or Playwright. Without that written down, the
next attempt either re-derives it or takes the local-first path without noticing it has given up the
web harness.

It also records the near-free adjacency: the day HR trace is bucketed by **mean**, so the range that
shipped is labelled "15-min averages"; `oura_bucket.hr_min` / `hr_max` would let it say Low and High
honestly, in the same route change.

## 2026-08-30 — `docs/implementation-backlog.md` 12796 → 12846, `projectOverview.md` 8156 → 8189 (PS-15 / LA-35)

**Backlog, +50.** Two things, both queue material rather than narrative. **PS-15** shipped two of its
three halves, so its entry had to stop describing the phase and units work as owed and start naming
what still is — a `Needs: PS-16`, a `Keep:` for the steps half only, and, on each shipped paragraph,
what the endpoint now returns instead. An entry that reads as fully outstanding when two thirds of it
landed is exactly the shape `check-backlog-pointers.js` exists to prevent, so the growth is the queue
staying true rather than the queue accreting. The rest is **LA-35**, a new entry: the module map
points at `lib/health/…` for 34 modules that live in `packages/shared/src/health/`, and
`check-index-doc-paths.js` whitelists precisely that error class in its `resolves()` fallback. Its
length is the 34 filenames and the one-line diagnosis of why the check passes — both are what the
implementer needs and neither is re-derivable.

**projectOverview, +33.** One Current Status paragraph for PS-15 and one Known-Issues row for LA-35.
The row is longer than a bare finding because it has to say what it does *not* contradict: a 🟢 row
further down records the module map's `path → symbol` claims as holding, 110 of 110, and that check
verifies attribution to the right *file* — not that the file is in the right *directory*. Without
that sentence the two rows read as a contradiction and the next reader has to re-derive which is
right.
## 2026-08-27 — `docs/implementation-backlog.md` raised (BF-43, and BF-35's two decisions closed)

47 lines net. BF-43 is filed from the owner asking whether the AI will see the clinical results. It
will not: the chat has 16 tools, none reaches `measured_rmr`, and the one tool carrying body data
returns weight with no body-fat percentage. Nothing filters it — it was never wired in.

The length is the safety argument, which is the half a shorter entry would drop. **The three results
are three different permissions.** RMR and DEXA composition are calorie and protein inputs the app
already reasons in. A blood panel is where a general model is most confident and least qualified —
handed `ALT 46, ref 0-45` it volunteers liver advice. So values and the provider's own flag go in,
interpretation does not, and the refusal gets tested with a leading prompt rather than assumed.

BF-35's two open decisions are closed in the same diff (store bytes, not the OFF URL; the image
lives where its ownership does), replacing the recommendations with the decision and the reason.

## 2026-08-27 — `docs/implementation-backlog.md` raised (BF-44, BF-41 promoted, BF-43's storage decided)

Net after merging main, which removed the shipped PS-14. BF-44 is filed from the owner describing an
injury-aware coach — and most of what they described already ships: `activeInjuredMusclesInSession`,
the periodization swap, `injurySafeAlternatives`, Coach's own injury logging. Saying that plainly is
half the entry's value, because building it again is the obvious wrong move.

The real defect is narrower and worse: `lib/ai-chat/tools.ts` and `context.ts` contain `injur` **zero
times**, so the chat surface will talk a user through a deadlift progression while the workout screen
substitutes the movement out. Two surfaces, opposite advice. The fix is an always-on context line
rather than a tool — a tool fires only when the model thinks to call it, and an injury has to
constrain answers the model does not recognise as injury questions.

## 2026-08-27 — `docs/implementation-backlog.md` raised (BF-45, BF-46, and BF-39 re-reported)

97 lines. Eight owner reports against the live Nutrition tab, filed as two batched Lane B entries
plus a note on an entry that already existed.

The value is in what tracing them found, which is less than eight problems. **"Adding an image
doesn't show it" and "the photo should be at the top" are one bug**: every layer of the photo
plumbing works, and `saved-meals-sheet.tsx:672` renders the picker below `Add ingredient` at the
bottom of a scrolling builder — while the detail sheet's `Add a photo` hero opens that same builder
rather than a picker, so the user lands above a control they never see. And **"an AI meal floods the
list" is BF-39**, already filed, now with a screenshot of one breakfast as eight rows and a sharper
requirement than the original: a collapsed parent that expands to its ingredients, which is also the
first place a meal photo could live.

Two are one-liners with a reason worth recording — `nutrition-action-row.tsx` puts three buttons in a
two-column grid, and `meal-card.tsx` keeps its P/C/F footer inside `CollapsibleContent`, so
collapsing a meal drops the summary that collapsing exists to leave behind.

## 2026-08-27 — `docs/implementation-backlog.md` raised (the owner answered the four open questions)

39 lines across BF-45 and BF-46, and one of them is a correction rather than an addition.

**The photo report was misdiagnosed here and the entry now says so out loud.** It read as "the picker
was never found"; the owner had found it, saved, and the photo did not appear. So there is a real
save failure, unreproducible in source — every layer seeds and sends correctly — and the entry now
carries the device candidates and the one check that splits a write bug from a render bug (read the
row back after a save that looked fine). Deleting the wrong guess would have let the next session
re-make it.

The gutter report also changed shape: asked which screens, the owner named bottom sheets rather than
screens, which turns a per-screen sweep into one change in the shared `SheetContent side="bottom"` —
with the warning that bottom sheets already own their bottom inset, so it is horizontal only.

## 2026-08-27 — `docs/implementation-backlog.md` raised (BF-46's layout chosen)

17 lines (13027 after merging main twice more): option A recorded as a band-by-band table, replacing the link-and-wait note. The table
exists because a prose description of this exact layout is what sent the entry round once already —
"more distinct macro and total calorie buttons" has a dozen valid readings, and the drawing settled
which one. The entry now says the drawing wins where the two disagree, and keeps B and C named only
so a later session does not re-open a decision the owner has made.

It also records what A costs — the tallest of the three, two stacked result blocks, may scroll on a
long food name — and what to do about it, which is tighten the gaps rather than merge the blocks,
because merging them is option B and the owner did not pick option B.

## 2026-08-27 — `docs/agents/state/bugfix.md` raised 161 → 204 (the baton was four sessions stale)

The BugFix baton still said *"Current: BF-9 filed, next is BF-10"* while the queue held BF-46. A
successor trusting that line would have collided on nine numbers, so the ID line now says to run the
grep rather than trust the line — the failure was believing a hand-maintained number, and the fix is
to stop having one.

The 44 lines are the session's record: the six owner decisions taken across three days (dark-only,
the warning row, food-image routing and storage, store-everything for the clinical results,
weight-only ingredients, quantity-sheet option A), a pointer to the de-identified clinical baseline
with the three numbers a successor should not re-derive, and six method notes. The sharpest is the
first: eight owner reports about one tab became fewer causes than reports, and filing eight numbers
would have buried the two real bugs among six duplicates.

## 2026-08-30 — `docs/implementation-backlog.md` raised (BF-21's owner gate cleared)

6 lines (13099 after merging main repeatedly). The owner enabled `pg_stat_statements` on Railway and verified it in the console, so the
gate is struck with the evidence rather than a bare tick — `SHOW shared_preload_libraries` and the
`pg_extension` count, both quoted, because a later session should be able to tell a cleared gate from
an assumed one.

Two lines are a warning the entry did not carry: the counters start empty at the restart, so an early
read proves nothing, and `pg_stat_statements.max` silently evicts the least-executed shapes once
5,000 are tracked. Checking `dealloc` is 0 is what separates "nothing slow is happening" from "the
slow thing was evicted".


## 2026-08-30 — `docs/implementation-backlog.md` raised (LB-19's premise replaced by measurement)

17 lines (13116 after merging main four times; it raised the number three times of its own —
two entries genuinely disagreeing about one number is the case this file conflicts on correctly). The entry said two flaky e2e specs
were a sandbox **time budget** and prescribed
`test.setTimeout`. Measuring both showed neither is, and the prescription would have fixed neither —
so the replacement is longer than the claim it removes, because the two failures turn out to have
nothing in common and each needs its own mechanism written down.

`goal-invalidation` fails on a locator that never resolves, 60 s into a test with a minute of budget
left: the seed's newest steps row was five days old and the row it asserts on cannot render without
one. `meal-label` fails intermittently on a zxing decode returning null, and the guard before that
read (`inkFraction > 0.01`) cannot distinguish the new style's paint from the previous style's — the
canvas already has ink. The entry also records why the obvious fix for the second (poll the decode
until it succeeds) is wrong: every style encodes the same meal, so a stale paint decodes to the same
token and would pass.

Kept because the class generalises: a spec that depends on the seed having run *recently* is the
hardcoded-timestamp rule wearing a different hat, and CI's fresh database makes it invisible exactly
where it would be caught.
## 2026-08-30 — `docs/implementation-backlog.md` raised (the first device pass came back)

185 lines (13301 after merging main): six new entries and three amendments, from the owner working the device queue.

Most of it is BF-50/BF-51/BF-52 — surface findings that are cheap to state and expensive to
rediscover. The two that earn their length are traced rather than reported. **BF-47** is CLAUDE.md's
own rule broken: `use-food-logs-loader.ts` calls the server copy authoritative and re-fetches it
immediately after an optimistic delete, while the delete is still queued in the outbox — so the
server puts the row back, which is exactly the flicker the owner described. The entry carries the
warning not to invert that authority, because the comment on that line records the opposite bug it
was written to fix. **BF-48** is why N7 could not be run at all: the food database is reachable only
from the meal builder's ingredient picker, so Log Food's `Single foods` searches nothing but history.

Three items also came back as *questions* rather than results, which is a finding about the queue
rather than the app — A1, A4 and W3 were written for a reader who already knew what they changed.
They are re-worded in `device-verification-queue.md` with the actual gesture, the actual way to
induce a failure, and where the screen is.


## 2026-08-30 — `docs/implementation-backlog.md` 13301 → 13373, `projectOverview.md` 8189 → 8226 (BF-38 / LA-36)

**Backlog, +72** (re-measured twice while `main` moved underneath; both of its own raises landed first). Most of it is BF-38 correcting itself. Two of that entry's premises were falsified
by measurement before anything was built — the "unambiguous" barcode case cannot key on a column
that is NULL on all 221 rows, and the AI's duplicate names are usually byte-identical rather than
fuzzy — so both paragraphs are rewritten in place rather than left to be read as true by the next
session. The replacement is longer because the *reason* the residue cannot be closed by a looser
rule is the finding: `food_logs` multiplies against the item's serving size, so merging two servings
of one food changes what a log means. Deleting that paragraph would mean re-deriving it, and the
obvious wrong move (a calories-per-gram rule) is the one it exists to stop. The rest is **LA-36**, a
new entry: `food_items.image_data_uri` is written to the device on every create and read back by
nothing, with the three-row table naming which reads omit it.

**projectOverview, +35.** One Current Status paragraph and one Known-Issues row. The row is a
device-verification gate, so it carries the smoke step and — the part that is not boilerplate — why
the device path is *different code* rather than the same code untested: it de-duplicates before an
id is minted, because the offline push deliberately does not de-duplicate at all.

## 2026-08-30 — `projectOverview.md` 8226 → 8258 (LA-37)

One Current Status paragraph and one Known-Issues row for a fault found in `error_events` rather
than reported: the Voice button was not rendering on the APK at all, because a getter resolved to a
raw `registerPlugin()` proxy and the promise never settled.

The row is longer than a bare device-verification gate because the useful part is **why no existing
check could have caught it** — `Capacitor.isNativePlatform()` is false in `pnpm dev` and in
Playwright, so the native branch never executes outside a real WebView, and a reader who does not
know that will read "unit tests pass" as "verified". The status paragraph carries the distinction
the new CI check turns on (a `registerPlugin` proxy is the hazard; `BleClient`, which looks
identical at two other call sites, is a plain instance and correct), because that is the sentence
that stops the check being "fixed" into flagging two working files.

## 2026-08-30 — `projectOverview.md` 8258 → 8291 (BF-39, engine half)

One Current Status paragraph and one Known-Issues row.

The row is not about the feature — nothing renders differently, because the rendering is Lane B. It
is about the **local SQLite version bump**, which is the part with a history: the local DB has been
silently dead twice from migration bugs, and both times every local read returned empty, which is
where the recurring "my data disappeared" reports come from. So the row spends its length on why the
two CI checks passing is not the same as the upgrade having run, and on a smoke step whose failure
signature (an empty Nutrition tab, not a missing day) tells the two apart. A shorter row would leave
the next reader to re-derive that, and the obvious wrong reading — "checks are green, it is fine" —
is the one it exists to prevent.

## 2026-08-30 — `docs/implementation-backlog.md` 13373 → 13385, `projectOverview.md` 8291 → 8322 (BF-47)

**Backlog, +12 net** (26 added, 14 removed). Almost all of it is BF-47 correcting its own trace. The
entry said the loader renders the server copy unconditionally; it does not, and the two mechanisms
that actually fit are what decide *where* the filter has to go — before `applyDelta`, not after,
which is the difference between fixing the flicker and fixing the half that survives a screen swap.
Leaving the original trace in place would have sent the next reader to the right file with the wrong
model. The removal is the "sibling sweep required" paragraph, replaced by the sweep's measured
answer: `applyDelta(` has exactly one call site outside the sync engine, so there are no siblings of
this shape.

**projectOverview, +31.** One Current Status paragraph and one Known-Issues row. The row spends its
length on *why nothing here counts as verification* — no sandbox has a local store, and the hook
cannot even be rendered — because "8 of 8 mutations caught" reads like proof and is not proof of
this. It also names the second smoke case (a food logged on the web, on another day), which is the
one the filed trace did not cover and the one most likely to be skipped.

## 2026-08-30 — `docs/implementation-backlog.md` 13385 → 13392 (BF-48 lane correction)

Seven lines correcting one field. BF-48 was filed `Lane: A for the search wiring, B for the row`;
Lane A took it off the queue, went looking for its half and found none. The correction carries the
four checks that establish that — the route needs no change, the only fetch of it is in a component,
`ingredient-search.tsx` takes `dbResults` as a prop so the piece to reuse is component state, and the
mismatch threshold is already shared — because a bare `Lane: B` invites the next Lane A session to
re-derive the same four greps before believing it.

## 2026-08-30 — `projectOverview.md` 8322 → 8329 (BF-39 follow-up, MRU)

Net +7: one Current Status paragraph, against the LA-35 Known-Issues row this branch's predecessor
moved out to the archive. The paragraph keeps the sentence about the first implementation putting
the same subquery in the SELECT and the ORDER BY — the ordering worked, the selected value came back
null — because it is a concrete argument for a rule this repo states abstractly, and the abstract
version has not been enough on its own.

## 2026-08-30 — `projectOverview.md` 8329 → 8337, `docs/implementation-backlog.md` 13392 → 13401 (BF-41, DEXA storage)

`projectOverview.md` +8: one Current Status paragraph, of the same shape as its neighbours. It is
seven lines rather than three because two of the sentences are the ones a reader would otherwise ask
for — that no source document is stored, and that there is still **no way to enter a scan from the
app**. The second matters more than the feature: without it "DEXA storage shipped" reads as a
capability the owner has, and they do not.

`docs/implementation-backlog.md` +9 net: BF-41 gains a shipped-so-far line and a **`Keep:`** naming
the three things still owed (extraction, the blood panel, the Lane B upload/crop/confirm surface),
and BF-2 gains a line saying its dependency is satisfied and what it still owes itself. Per the rule
that a finished entry must not sit in the queue looking finished, an entry that ships half its work
states what is left rather than being deleted — which is exactly what these lines are, so the growth
is the mechanism working.

## 2026-08-30 — `docs/implementation-backlog.md` 13401 → 13408 (LB-21 out, LA-38 in)

LB-21's 23-line entry left the queue and LA-38's 30-line entry replaced it, at the same position.
Net +7, and the seven are the measurement: LA-38 was filed as a token-cost note and then measured,
which turned it into an availability bug — a plan the library filled completely returns 502 when the
model is down, having needed nothing from it. That reversed the recommended fix (skip the call, not
make it cheaper), so the lines are the difference between an entry the next session would implement
wrongly and one it would not.

## 2026-08-30 — `projectOverview.md` 8337 → 8347, `docs/implementation-backlog.md` 13408 → 13376 (LA-38 shipped)

The backlog **shrinks 32**: LA-38 left the queue the same day it was filed, so the ratchet moves the
right way and the new number is the floor.

`projectOverview.md` +10, one Current Status paragraph. It is ten lines rather than four because the
reading that matters is not "the route stopped wasting tokens" — it is that an AI outage was breaking
a plan the AI had nothing to do with. A status line that led with the tokens would leave the next
reader thinking this was an optimisation, and the reproduction (no API key: pre-fix 502, post-fix
200) is the sentence that stops it.

## 2026-08-30 — `docs/implementation-backlog.md` raised (second device pass; net +54 after a closure)

68 lines added and one entry deleted. **BF-53 is most of it and it is a live production defect found
in an aside.** The owner mentioned, while answering a different check, that the "Not me" button on a
pending weigh-in does nothing. Both that route and its sibling validate a `bigserial` id with
`invalidUuidResponse`, so every press returns 400 before the `Number.isInteger` guard written for it
— the whole pending weigh-in triage is dead, and the client's `if (res.ok)` with no `else` is why it
looks like a no-op instead of an error. The entry carries the sweep: any dynamic route whose key is
an integer rather than a UUID has the same shape.

The rest is device findings landing on the entries that predicted them — Q-499 confirmed as a real
failure, Q-538 measured at 652,417 rows and 95.7 MB, Q-318's redecode reporting observed rather than
inferred, and Q-316 re-framed, because a pack button that cannot be pressed is not "correctly
disabled at zero" when 652k rows exist.

**BF-16b was deleted rather than ticked.** The owner rejected the correction — `Shikai / Lower` has
no Primary lift on purpose — so the finding moved to BF-15, the rule that flagged it, as a constraint:
a live session may legitimately have no Primary, and nothing downstream may treat that as a defect.

## 2026-08-30 — `docs/implementation-backlog.md` raised (three screenshots, measured against production)

95 lines: BF-54, BF-55, BF-56, plus verdicts on three device checks.

**The measurement is what earns the length.** The owner's console screenshot showed
`oura_raw_samples` at 297 rows in 67 MB, which reads as pure bloat. Queried against production the
same hour: `n_live_tup` **552**, real `count(*)` **180,415** — a 327× under-read, with `rr_intervals`
reading 0 against 87,015 and `error_events` 1 against 6,102. The console prints that counter as a row
count *and* uses it to justify a VACUUM FULL whose own comment says a huge size against few live rows
means bloat. Acting on that verdict takes an ACCESS EXCLUSIVE lock and reclaims nothing. Recording
the numbers matters because the wrong conclusion was one sentence away and looked obvious.

**BF-55 is the half that survived the check**, from the size columns, which are exact: 84 MB of index
against 63 MB of heap across the database, and 206 MB total against the 171 MB baseline of 12 days
earlier — roughly seven times the expected trend, which CLAUDE.md says to record the same session.

**BF-56 came from a screenshot that exonerated the feature.** Coach's swap card was reported as
"only allowed for making it primary" and in fact proposed the swap correctly; one line in its
consequence list disclosed a role promotion nobody asked for, which silently undoes the owner's
deliberate no-Primary session. The card is not at fault — disclosing the change is how it was caught.

## 2026-08-30 — `docs/implementation-backlog.md` raised (third device pass; four of six reports already filed)

85 lines, and the ratio is the point: **six owner reports produced one new entry.** Four landed on
entries that already existed, which is what the dedup rule is for — the meals-in-a-nest ask is BF-39's
*third* report in five days and got a note rather than a fourth number.

**BF-45 ④ is the find.** The macro ring "starts at an odd spot" because all three call sites write
`conic-gradient(from -90deg, …)`. In CSS a conic gradient already starts at 12 o'clock, so `-90deg`
rotates it a quarter turn counter-clockwise to 9. The `-90` is correct for SVG and canvas, where 0°
is at 3 o'clock, and was carried across. Home's ring is offset identically and nobody had noticed.

**BF-57 is a decision rather than a defect.** A printed meal label carries a bare `saved_meals.id`
and the scanner resolves it against the scanning user's own meals, so another person's label reports
*"no longer exists"* — wrong twice, since the meal exists and the reason is ownership. The entry
argues against the obvious fix: globally resolvable meal ids turn a photograph of a label into read
access to someone's health data, on an app heading for a Play Store health declaration. The
recommendation is a share token that **copies**, so the two users' rows stop being coupled the moment
the scan lands.

## 2026-08-30 — `docs/implementation-backlog.md` raised again (BF-57's design settled by measurement)

68 further lines on BF-57. The owner rejected the share-token recommendation and proposed putting the
whole meal in the QR. **Measured rather than argued**, because the answer was not obvious either way:
their real 3-ingredient meal is **167 bytes** as positional JSON, needing QR version 9 at 53×53
modules — and the binding constraint turns out to be the printed label, not the format. At the
current 12.2–16.4 mm code that is 0.31 mm per module, too fine for a home printer; at 30 mm it is
0.57 mm, better than the design's own current worst case.

So the entry now carries a capacity table by ingredient count, a cap at ~5 ingredients with the
instruction to refuse the print above it and say why, and one counter-intuitive measurement worth
keeping: **compressing makes it worse** — deflate plus base64url came out 164 bytes against 146 for
plain compact JSON, because base64's 33% tax exceeds the gain at this size.

The superseded token design is kept in a collapsed block rather than deleted, with the reason it
lost, so nobody re-proposes it. The one part of it that survives unconditionally is the security
argument: never make `saved_meals.id` resolvable across users.

## 2026-08-30 — `docs/implementation-backlog.md` raised (BF-57: how the ingredient list gets cut)

25 lines. The owner settled the sizing — grow the QR, trim the list — and the entry now says *how*,
because the two obvious ways to trim are not equal and one of them is a data bug.

Measured: truncating ingredient names is cosmetic. It buys one QR version (280 → 240 bytes on a
5-ingredient meal) and cannot rescue a 10-ingredient recipe, which stays at 0.35 mm/module and
unprintable, while making brands unreadable. **Rolling the tail into a single remainder line carrying
the dropped items' summed macros gets a 10-ingredient meal to 244 bytes, version 11, 0.49 mm/module**
— printable, and the totals stay exact to the gram.

Hence the rule the entry now leads with: **the totals are sacred, the detail is negotiable.** Dropping
ingredients to save bytes silently changes the meal's calories, and the person scanning the label has
no way to know. Only identity may be dropped, never numbers — and the printed label has to say it is
showing four of ten, or it reads as the whole recipe.

## 2026-08-30 — `docs/implementation-backlog.md` (net ~+8: a `Gate:` field removed from four entries)

Found while reporting queue state: `Gate: device` **parks** an entry in `next-item.js`, and in this
queue it means *shipped, awaiting a device check* — which is how BF-24, BF-26, BF-34 and Q-406 use
it. BF-45, BF-46, BF-50 and BF-51 are unbuilt, so carrying it hid the whole `nutrition-ui-uplift`
batch from Lane B's runner: four entries, the owner's most-repeated surface complaints, invisible to
the tool an implementer is told to start from.

Removed, with a note on each explaining why not to add it back. The device is still what judges these
done — that belongs in Verification, which all four already state. **A gate parks work; a
verification requirement does not.** The rule was in `docs/agents/README.md` the whole time; it was
filled in from the field name rather than from the runner.
## 2026-08-30 — `projectOverview.md` 8347 → 8357, `docs/implementation-backlog.md` 13376 → 13330 (BF-21 shipped)

**Amended on the merge with `main`.** Two branches touched this number in parallel — the second
device pass raised it to 13539 while BF-21 lowered it to 13330 — so the conflict is two PRs
disagreeing about one document, which is the case the per-file split is meant to surface rather than
hide. Resolved to the merged file's actual **13493**: both sides' edits are present, and the ratchet
sits on the truth rather than on either branch's view of it. Then **again**, on a second re-merge minutes
later: `main` had moved twice more and the number was 13731, resolved the same way to the merged
actual. Three branches disagreeing about one line in one morning is the shape to expect while several
agents are landing — the resolution is never to pick a side, it is to count the file.

The backlog **shrinks 46** — BF-21 left the queue, and the new number is the floor.

`projectOverview.md` +10, one Current Status paragraph. Two of its lines exist to stop a wrong
conclusion rather than to describe the change: that the counters start empty from the restart, so a
read in the first hours means nothing, and that BF-19 already measured the database and it is not
where the reported slowness is. Without them the next session reads a clean `pg_stat_statements` and
closes the slow-load question on it, which is the mistake the entry itself warned about.

## 2026-08-30 — `projectOverview.md` 8357 → 8367, `docs/implementation-backlog.md` 13685 → 13652 (BF-54 shipped)

The backlog **shrinks 33** — BF-54 left the queue, and the new number is the floor.

`projectOverview.md` +10, one Current Status paragraph. Half of it is the three measured pairs
(552/180,415 · 0/87,015 · 1/6,102), and they earn the space: without a number the entry reads as
"the console was slightly off", and the actual finding is that a button which takes an ACCESS
EXCLUSIVE lock was being justified by a figure three orders of magnitude wrong. The last sentence —
that the SIZE columns were never wrong — is there because the neighbouring reflex is to distrust the
whole readout, and Q-528 was a data-loss incident filed on exactly that over-correction.


## 2026-08-30 — `docs/implementation-backlog.md` 13652 → 13704 (LA-39 filed)

52 lines, and they are the ones a `GRANT` decision needs rather than a description of it. BF-21
shipped, its pass test passes, and every row's `query` still reads `<insufficient privilege>` — so
the entry has to say what was measured on production, that the redaction follows the session role
rather than the view's owner (which is what stops the next session trying `security_invoker`), and
what `pg_read_all_stats` does and does not widen. Left shorter it reads as "grant this", and the one
thing an owner-gated entry must not do is hide the trade-off it is asking about.

## 2026-08-30 — `docs/implementation-backlog.md` 13704 → 13749 (BF-55's measurement landed in the entry)

45 lines, and they are a table plus the two things the table alone does not say.

The first is that the entry's own rule — *"an index never scanned is a candidate to drop"* — is wrong
for three of the four zeros it turned up: `idx_scan` counts reads, not constraint enforcement, so a
PRIMARY KEY or UNIQUE index consulted on every insert reads as never used. Deleting that paragraph to
save lines would leave a correct-looking rule that recommends dropping constraints.

The second is that the one real candidate, at 18 MB, is the keyset index for a method **Q-180
deliberately kept** on the stated ground that *"it costs nothing at runtime"*. Reversing part of a
signed-off decision needs the decision quoted and the new number beside it, or the next reader is
choosing between two sentences with no evidence attached to either.

## 2026-08-30 — `projectOverview.md` 8367 → 8381, `docs/implementation-backlog.md` 13749 → 13639 (BF-53 fixed, LA-39 closed)

The backlog **shrinks 110**: BF-53 collapses to a `Keep:` for the device check and LA-39 leaves
entirely, an hour after it was filed — the owner ran the grant and the query text is live.

`projectOverview.md` +14, two Current Status paragraphs. BF-53's says what the buttons did rather
than naming the guard, because "a bigserial validated as a uuid" describes a line of code and the
finding is that a feature was dead in production. LA-39's is five lines and closes itself in the same
breath it opens, which is the shape a same-day resolution should take here — the alternative is a
Known-Issues row filed and struck within the hour.


## 2026-08-30 — `docs/implementation-backlog.md` (nutrition to the top, re-derived from current main)

Replaces an earlier attempt that had gone stale. A reordering branch carries a full copy of every
entry it moved, so the longer it stays open the more of those copies rot — and on this repo `main`
moves every few minutes. That branch had already come within one merge of **resurrecting BF-54 after
it shipped and reverting BF-55 to its pre-fix text**, both caught only by diffing each moved entry
against `main` rather than trusting the conflict resolution.

Re-deriving the move from current `main` in one pass removes the whole class: nothing is carried, so
nothing can be stale. **The lesson for the next reorder: do it in one commit against fresh `main` and
merge it the same minute, or expect to hand-verify every moved entry.**

## 2026-08-30 — `docs/implementation-backlog.md` raised (BF-58 and BF-3, re-derived)

Replaces an earlier branch for the same two entries. Same reasoning as the reorder: the branch had
been open across several merges and its conflict region held `main`'s copies of BF-53 and BF-47,
both of which shipped in the meantime. Re-deriving against fresh `main` and re-applying only the two
intended changes means neither can be reverted by accident.

**BF-58** is the partner's weigh-ins, settled on per-phone weight-band attribution: the scale pairing
is device-local `localStorage`, so both phones can already pair and the problem is attribution rather
than ownership. No cross-account path is needed, which is most of the argument. **BF-3** is dosed
substances, promoted and classified Lane A because the owner is about to start retatrutide and dose
lives on the definition rather than the log — so raising a dose rewrites every past entry, and the
titration schedule is exactly what a titrating drug's record consists of.
## 2026-08-30 — `docs/implementation-backlog.md` 13639 → 13691, `projectOverview.md` 8381 → 8392 (BF-57 engine half)

**Amended on the merge with `main`.** #622 reordered the nutrition entries to the head of both lanes
while this branch was open, so the conflict looked like two deletions and was **not** one — the five
entries were MOVED, and taking neither side would have deleted BF-49 through BF-52 outright. Resolved
by taking `main`'s side at the old position and then replacing its relocated BF-57 with this branch's
`Keep:`. The check that catches the real two-deletion case cannot see this one, which is the argument
for reading the headings before choosing rather than applying the rule by shape.

The backlog **shrinks 100**. BF-57's entry was 8,244 characters of design argument — the byte
measurements, the two encodings compared, the token design it superseded — and all of it is now
either in the shipped module's comments or in the journal. What replaces it is 2,748 characters of
`Keep:`, which is what Lane B still has to build.

`projectOverview.md` +11. The paragraph spends its last two lines saying **no user-visible change
yet**, and that is the point of it: "the whole meal is in the QR now" reads as a shipped feature, and
what shipped is a module nothing calls. A status line that let the owner think labels were shareable
would be worse than no line.

---

## 2026-08-30 — `projectOverview.md` 8392 → 8394 (nutrition UI uplift: BF-45 / BF-50 / BF-51)

One Current Status paragraph for a batch of eight shipped fixes across two device passes, plus its
blank line. Two lines for eight items is proportionate, and a status paragraph is what this section
is for.

**A trim was looked for first and the obvious candidate was wrong.** Two ✅ Q-479 entries sit in the
Known Issues section with near-identical headings, ~37 lines each, and they read as a merge that kept
both sides. They are not: the second says outright that it is *Review's original finding* and that
the Lane A row higher up carries what shipped. Body similarity is 0.09. Deleting either would have
destroyed a deliberate pairing to save two lines — recorded here so the next session tempted by the
same easy win does not take it.

(The earlier raise this session was avoided rather than taken: BF-48's paragraph was paid for by
cutting two lines of meta-narration from the section's closing note, which was explaining why 157
status notes were archived on 2026-08-17 — the archive's business, not the index's.)

---

## 2026-08-30 — `projectOverview.md` 8394 → 8396 (LB-19, the meal-label style gate)

One Current Status paragraph plus its blank line, for a finding that changes what an existing spec
was known to be checking: the decode loop had been reading the previous style's canvas on every
iteration and passing because all six styles encode the same meal. That belongs in the index rather
than only in a journal entry — the next person to touch the label renderer needs to know the spec
was not covering what its name says.


---

## 2026-08-30 — `projectOverview.md` 8396 → 8398 (Q-154, the sparkline primitive's missing props)

One Current Status paragraph plus its blank line. It earns the index rather than only a journal entry
because of one sentence: `valuePadding` defaults to 0.5 and that renders a small spread at half its
true amplitude. Anyone reaching for the primitive needs to know that from the orientation read, not
after shipping a chart that understates its own data — which is exactly what Q-154 refused twice.
## 2026-08-30 — `projectOverview.md` → 8409, `docs/implementation-backlog.md` → 13411 (BF-3 gap 1)

The backlog shrinks: BF-3's 5,846-character entry becomes a 3,177-character `Keep:`, since the three
gaps it diagnosed are now one shipped and two queued, and the design argument for the shipped one
lives in the migration's own comments.

`projectOverview.md` +11, one Current Status paragraph, and two of its lines are the ones that stop a
wrong reading. The first is that it works with the dose already typed in — without it "the dose is on
the log now" reads as a feature the owner has to go and configure before their history is safe, which
is the opposite of what shipped. The second is the **v32** device warning: a local SQLite migration is
the highest-risk change this repo makes, and a paragraph announcing a fix without saying it is
unverified on the phone is how a Known-Issues row gets skipped.

## 2026-08-30 — `projectOverview.md` → 8420, `docs/implementation-backlog.md` → 13368 (TN-13 shipped)

The backlog shrinks: TN-13's 5,628-character entry becomes a 2,493-character record of what was
measured plus a device `Keep:`. Most of what left was the argument for the design — the correlation
table, the two rejected alternatives — and that now lives in the shipped module's own comments, where
someone changing the rule will actually be standing.

`projectOverview.md` +11. The paragraph carries the re-measured numbers rather than the entry's,
which is the point of it: TN-13 said 2.11 / 0.33 / 84 % over 50 nights and the same query over 71
gives 2.50 / 0.58 / 77 %. Same conclusion, and restating it is cheaper than the next session
discovering the discrepancy and wondering which figure was wrong.
## 2026-08-30 — `projectOverview.md` +2 (LB-26, the APK banner's tap target)

One Current Status paragraph plus its blank line. The defect half is small; the half that earns the
index is the process one — a `Gate: device` applied to unbuilt work parks it from `next-item.js`, and
it happened here to a session that had read the warning about it hours earlier. The rule moved to the
backlog's protocol header in the same PR, which is the durable fix; this line is what makes an
orientation read mention it at all.

**Re-derived on each rebase as PRs landed under it; final 8422 → 8424.** The branch was cut before Q-154 landed
and two more PRs merged under it while CI ran; every paragraph is kept, so the number is set from the
merged file each time rather than from either side of a conflict.
---

## 2026-08-30 — `projectOverview.md` 8422 → 8424 → 8405 → **8413** (Q-392, settings follow the account)

One Current Status paragraph plus its blank line, for the owner's own report finally being answered.
The half that earns the index is the rule that was wrong: hydration cleared any key the server bag
did not carry, which is right for a settled system and wrong in the window between a tap and its
PATCH landing — and offline it reverts every change on the next launch. CI caught it. That is the
kind of thing an orientation read should surface before someone adds the next preference.

(The number moved four times while this sat in CI; set from the merged file each time. The third
move was DOWN — a compaction on `main` had left 20 lines of slack under the baseline, and a
ratchet is only worth having if it sits on the file. The fourth is BF-45 ⑤'s own paragraph
landing on `main` under the old slack, which is what tightening converts from invisible into a
number someone has to write down. That is the trade, and it is the right one.)

## 2026-08-30 — `projectOverview.md` 8413 → **8425** (BF-46 ①b, the meal photo's CSP block)

Twelve lines for a paragraph that is mostly one transferable fact: **a `fetch()` of a `data:` URL is
a `connect-src` request**, and this app's CSP does not allow one. That is not a nutrition detail —
it is a rule any surface handling an image from a plugin can break, on the native branch only, where
nothing in this repo runs. It cost three owner reports and a held rebuild before anyone read the CSP.

The rest of the story is in the journal entry and in `docs/module-map.md`'s row, which is where an
implementer reaching for `fetch(dataUrl)` would actually be looking.

## 2026-08-30 — `projectOverview.md` 8425 → **8437** (BF-46 ② ③, the quantity editor's Option A)

Eleven lines, and the half that earns them is the **departure**: the chosen drawing puts the unit
toggle at the stepper's height, and this app's 48 dp floor makes a stacked two-option toggle 96 px,
so the stepper grew rather than the toggle shrinking. A session that reads only the artboard and
only the shipped code will see a disagreement and "fix" it back — including by reaching for
`.tap-dense`, which is what the floor exists to refuse.

The rest — what was built, what the e2e asserts, why the geometry rather than the text — is in the
journal entry.

(Re-derived on the rebase: this branch was cut at 8413 and BF-46 ①b's paragraph landed under it.)

## 2026-08-30 — `projectOverview.md` 8437 → **8449** (BF-46 ①a, one picker per screen)

Eleven lines, and nine of them are the *failure*, not the feature. Moving a picker is a paragraph
nobody needs; what the index owes the next session is why a previous one built this, measured a
picked photo reaching nothing, and held it — the file was landing in the **other** instance of the
same component, because the screen being left is still mounted while it closes and both carried the
same accessible name.

That is the third time in one day a check was satisfied by the state it was meant to replace (the
meal-label ink gate, the builder's `Ingredients` marker, this). It is worth the lines until it stops
happening.

(Re-derived on the rebase: this branch was cut at 8425 and BF-46 ② ③'s paragraph landed under it.)

## 2026-08-30 — `docs/agents/state/implementation-lane-b.md` 109 → **126** (the seventeenth Lane B run)

Eleven lines after a run that merged six PRs and left two open. Two sections earn them and one was
cut to pay for them.

**Earning it:** three items are now blocked on the owner rather than on work — BF-51 ③, LB-29 and
the device pass for the whole shipped `nutrition-ui-uplift` batch — and each carries a written
recommendation, because a successor that re-derives them will reach a different answer and build the
wrong thing. And *a precondition satisfied by the state it is meant to replace cannot fail*, which
cost three separate investigations in one day and had already cost a previous session the whole of
BF-46 ①a.

**Paying for it:** the "What is genuinely left for B" heading is gone, folded into `Now` — the queue
survey it held is one `next-item.js` call away and does not need a section. Several gotchas were
merged into single bullets rather than dropped; nothing in the previous baton was deleted outright.

Six of the seventeen are a late addition: **BF-39 was built and held**, and a baton that said it
shipped would be the most expensive kind of wrong.

(Re-derived twice on rebases: this branch was cut at 8425, and BF-46 ② ③'s and ①a's paragraphs
landed under it in turn.)
## 2026-08-30 — `docs/agents/state/implementation-lane-a.md` 203 → 208 (Q-211 batch)

Five lines, and they are the two things a baton exists to carry. (`wc -l` reads 207 and the
check reads 208 — it counts a final line with no trailing newline, so trust the check.)

The first is a **correction**: this baton said the remaining Lane A work was *"almost entirely owner-
or device-gated"*, and that was wrong. It propagated — a session read the ~21 scoring entries at the
top of READY, reported the queue blocked to the owner, then found six startable items below them and
shipped all six. The baton is where that error lived for four days, so the warning belongs in it and
nowhere else; a journal entry would not be read before the same mistake was made again.

The second is two new rows in **Waiting on the owner**, which is the section that exists for exactly
those: nulling the corrupt `body_comp` snapshot, and dropping `oura_heartrate_user_updated`.

Paid for where it could be: the *Shipped this session* list was replaced rather than appended, and
the correction was compressed twice (six lines to four) before raising the number. What was **not**
done is trimming the previous session's `Traps` section to make room — it is 37 lines of durable
knowledge under a header that says "this session", and restructuring another session's baton to buy
five lines is a worse trade than this note.

## 2026-08-30 — `projectOverview.md` 8449 → 8453 (Q-211, the baseline deload exemption)

Four lines on the existing Q-185 status block, turning its *"related open issue"* pointer into what
actually happened. It earns the index because the fix is not the one the entry described: exempting
the branch Q-211 named left the behaviour unchanged, since a second branch re-applied the deload, and
that branch carried a comment calling such a clause unreachable — true when written, false the moment
the first exemption landed. A reader of this file should know the shipped fix has two halves.
## 2026-08-30 — `docs/implementation-backlog.md` (gate audit: three stale owner gates)

Small. Asked which entries were waiting on him, the owner turned out to be waiting on three he had
already dealt with:

- **BF-4** — the photo scan was run during the device pass (~4 s, no complaint), which is not the
  slowdown the entry was filed about. Gate cleared, with the instruction to close it as *stopped*
  rather than *fixed*, since no diff was traced to it.
- **LB-18** — answered on the device the same day, and the answer was written *above* the `Gate:`
  line while the line itself survived. **A cleared gate has to be struck in the field, not narrated
  next to it, because the runner reads the field.**
- **Q-388** — void rather than answered. It asked the owner to choose SpO₂ on or off; he refused the
  question and was right to, since SpO₂ was equally on under stock firmware at a quarter the drain.
  Re-marked as blocked on a device reading (S9), not on a decision.

The LB-18 case is the reusable one: an owner gate can be answered in prose and stay closed to the
tools, which makes it indistinguishable from an unanswered one at a glance.

## 2026-08-30 — `docs/implementation-backlog.md` (lane classification and the Railway aggregation)

Net negative on entries: 216 → 215, with Q-549 removed.

**Nine entries carried `Lane: ?` and were therefore offered by neither runner** — including BF-1, BF-2
and BF-9. Every one of them already described its own split ("engine is A, the surface is B"), so
none of them was actually undecided; the field simply never got the answer the prose already had.
Classified by CLAUDE.md's path rule, with the rule cited in each so the reasoning is checkable rather
than asserted. Eight resolved to a lane; **PS-4 stays `Lane: ?` on purpose** and now says so, because
the runner accepts only A or B and rewriting a baton is not implementer work — recorded so the next
audit does not try again.

**Three entries were asking the owner the same hosting question three ways.** Q-549's headline premise
was falsified on 2026-08-25 (423 MB flat at 0.0 vCPU, not 0.79 GB) and its only live residue was one
console setting, so it is folded into Q-551 and removed. Q-547's remaining half is re-framed as what
it is — a *reading* taken during a quiet window, feeding Q-551 rather than competing with it. **The
owner now has one Railway question instead of three.**

## 2026-08-30 — `docs/implementation-backlog.md` (the tuning sign-off, applied to one of four)

The owner signed off "the four tuning tasks". Checked against CLAUDE.md's bar for a scoring change —
*a proposal is incomplete until it states how many other days the change moves* — and **only TN-10
met it**, so only TN-10 carries the sign-off.

The other three are recorded as explicitly **not** signed, with the reason on each, because a blanket
approval applied to them would authorise things nobody intends:

- **TN-16** is a stop sign, not a request. Its own measurement (n = 33) is that stress-high minutes
  correlate the *wrong way*, so the warning it proposes **would fire on the owner's best days** — the
  entry calls that worse than no warning. Approving it approves a known-broken feature. Q-507 clears
  it.
- **TN-17** does not ask *may we change the score*; it asks **what the owner's step goal is**. Median
  day 4,649 steps against a stored goal of 7,000 reached on 19 of 60 days. The entry now carries the
  one-line question to put to them instead.
- **Q-422** is a legitimate sign-off blocked on `Needs: Q-420`, which sets the intensity scale it
  multiplies. Approving the multiplier before its input is fixed approves an unknown. Re-offer it
  when Q-420 lands.

Q-551 is marked **held** rather than answered, per the owner.

## 2026-08-30 — `docs/implementation-backlog.md` (BF-59, and TN-17 answered)

BF-59 is the largest of the two and earns it by being arithmetic rather than opinion. The owner
completed a full training week and the screen still showed them well short, so the question was
whether the target or the counting was wrong. **The counting is right** — 50 logged sets producing 79
muscle-set credits is the 0.5 secondary weighting working as designed. **The target is wrong**:
`program_volume_targets` stores a flat 14/10 large-small binary, which is precisely what
`volume-targets.ts` opens by saying it does not do, and it ignores the `powerbuilding` ×0.8 multiplier
on the owner's own active program. 128 displayed against ≈106 correct, and reaching 128 would need
~81 sets — 62% more than the program prescribes.

The per-muscle table is what makes it worth writing down: against goal-adjusted landmarks the owner
**exceeded** glutes and lower back and **met** hamstrings in the same week the screen painted them
red. A target that cannot distinguish "you are past the sweet spot" from "you are half way there" is
worse than no target.

TN-17 is a line: the owner kept 7,000 steps, and the entry now records that the number came from the
`sedentary` rung of a tier table rather than any per-person calculation — defensible by accident, and
worth saying so plainly.

## 2026-08-30 — `docs/implementation-backlog.md` (BF-59 reframed by one remark from the owner)

The entry was written as "flat binary plus a missing goal multiplier". The owner then said *"oh yes
cause its realization phase its been less sets"* — and that is the actual cause, with the original
two demoted to second-order. In a peaking block low volume **is** the prescription; the app's own
`explain.ts` calls realisation *"peak strength — heaviest load, lowest reps"* and `autoregulation.ts`
refuses rep pushes in it. So the screen painted correct training red.

Two things worth keeping from the trace. **MAV is an accumulation target**, so displaying it during a
peak is measuring the wrong thing rather than measuring it wrongly. And **phase is per program
session, not per week** — production shows the owner's sessions spanning `accumulation`,
`intensification` and `realisation` simultaneously — so a weekly target is a computation over the
phases the week contains, not a number that can be stored at all.

A question the entry had raised — *does the program prescribe enough volume to reach MAV?* — is
struck rather than deleted, because it was reasonable on the data available and the next person
looking at 50-against-106 without the phase would ask it again. That is itself the argument for
putting the phase on the screen.

## 2026-08-30 — `docs/implementation-backlog.md` (BF-60, a one-word rename with a reason)

Small, and it would be smaller still except for two things worth writing down. **The old label was
correct when written** — the file carries a comment explaining that `Single foods` names a
composition against one thing — and **BF-48 is what made it wrong** by giving that tab the food
database. So the entry says to update the comment in the same change, because a file defending a name
it no longer uses is how a later session talks itself into reverting.

And the wrinkle: `Meals` has a search box too, so `Search` is not strictly exclusive. The distinction
that makes the rename honest is that Meals *filters* a list you own while this tab *searches* beyond
it — which means the two placeholders have to read differently, or the rename swaps one ambiguity for
another. Batched into `nutrition-ui-uplift` rather than given its own PR and its own device look.

## 2026-08-30 — `docs/implementation-backlog.md` (BF-64, a one-way toggle)

Sixty lines for one owner sentence, and the length is the table. *"Pressing full or deload doesnt
change the prescription"* has a precise answer — `aiDeload` is read in an `else if` that only fires
when the exercise is **not** already deloaded — and stating it as a four-row grid of
prescription × toggle is what makes "the toggle is one-way" checkable rather than asserted.

The rest is the two hazards that would otherwise be found during implementation. `preDeload` is
optional, so a session-level revert cannot be all-or-nothing and the entry says to decide what Full
means for an exercise with nothing to revert to. And the 1RM/PR gate reads `isAnyDeload` **and**
`ex.deloaded`, so a revert that misses one of them either loses a real PR or writes one off deloaded
sets — an area that has already had a fix land, which is why it is written as a live hazard rather
than a caution.

The recommendation is to reuse `toggleDeloadRevert` rather than teach `/prescribe` an intensity
input: the full numbers are already carried on the prescription, so the cheap path costs no LLM
call, no rate-limit budget, and works offline.

## 2026-08-30 — `docs/implementation-backlog.md` (BF-65, a feature request that is mostly a cleanup)

The owner asked for one picture on one screen. Most of the entry is what reading the code turned up
around it: the same `/api/exercise-gif` fetch is hand-rolled in **four** files, so satisfying the
request naively writes a fifth and walks past the repo's own extract-before-the-third-copy rule.
Saying that in the entry is what makes the extraction part of the work rather than a follow-up
nobody files.

Two things are written down because they fail *quietly*. `next/image` silently converts a GIF to a
static image without `unoptimized`, so the feature would ship looking finished and never move — the
warm-up screen already carries the correct condition to copy. And the warm-up screen fetches every
exercise's media moments earlier and prefetches the binaries for the service worker, then unmounts
and drops the map; without a shared cache key the ready screen re-downloads what the app already has,
which is also what breaks the offline case.

The layout note is deliberate: the screenshot already cuts `SET TARGETS` off behind the action row,
so "add a picture" is a fold decision, not a drop-in.

## 2026-08-30 — `docs/implementation-backlog.md` (BF-66, a table that had to be measured)

The owner asked a question — *"it heard me correctly; is that not how to use it?"* — and the answer
is a six-row table produced by running `parseVoice` rather than reading it. `by` and `at` work while
`for` and `times` do not, because the strip is a character denylist that keeps every letter appearing
in `kg`/`reps`/`x`: `r` survives `for`, `es` survives `times`, and the two-numbers fallback then can
never fire. Nobody derives that from the source at a glance, and nobody derives it from using the app
at all, which is why the table is in the entry instead of a sentence saying the regex is fragile.

It also carries the reason the seven existing tests pass: every one of them is adjacent numbers or an
explicit keyword, so the filler-word gap is untested by construction rather than by oversight.

And the second half, which is the part that generated the report: the failure message prints the
transcript in red, so a *correct* transcript reads as the app mishearing. Fixing the parser without
fixing that message leaves the next unparseable phrase just as confusing.

## 2026-08-30 — `docs/implementation-backlog.md` (BF-67 and BF-68, the program builder's two blind spots)

Two owner requests about the AI program builder, filed separately because one is buildable and one
is a design.

BF-68 is measured: `injur` appears **zero times** across both builder routes and all three builder
components, and `generate-program`'s schema is a strict thirteen-field wizard payload with no
free-text field at all. The entry's real content is the trap — `builder-chat` *does* take free text,
so typing "I have a sore lower back" often works by luck, and then the constraint dies when the
program is saved while the daily engine, which already reads the injuries table, never hears about
it. That argues for feeding the existing records in rather than adding a field, and for the free-text
path writing a record instead of a prompt line.

BF-67 is flagged as a planning item because the owner's one sentence contains two payloads —
structure ("similar to") is ~30 exercise names, history ("what I did") is unbounded — and treating
them as one is how a prompt gets a year of set logs in it. It also carries two constraints worth
having before design starts: send a program id rather than a program object, and give the reference
its own schema caps rather than inheriting the byte-limit situation the route already documents.
## 2026-08-31 — `docs/implementation-backlog.md` falls as BF-70 and BF-2 are struck

Two entries out. **BF-2 is the one worth recording: it had shipped hours earlier and was still
sitting at READY #3.** `check-backlog-pointers.js` fails on a completion word in a queue *heading*,
and BF-2's were all in its body banner, so the check passed on an entry describing finished work. The
lesson is procedural rather than about size — re-run `next-item.js` after striking something, because
the edit is not the evidence.

Four references to BF-70 went stale the moment it was removed — BF-38's batch line and three lines in
BF-35 including *"Blocked by BF-70"*. Rewritten rather than left, for the same reason as LA-44's
earlier today: prose that points at a struck entry outlives the entry and gets trusted.


## 2026-08-31 — `projectOverview.md` 8453 → 8450, `docs/implementation-backlog.md` 13776 → 13762, `implementation-lane-b.md` held at 126
## 2026-08-31 — `projectOverview.md` 8453 → 8450, `docs/implementation-backlog.md` 13585 → 13571, `implementation-lane-b.md` held at 126

Three baselines fall; none rises. **Re-derived on the merge**: this branch was cut at 8449, and
Q-211's four-line paragraph landed under it. **`projectOverview.md`** loses four lines of merge debris — its
Current Status carried *three* duplicated `**Version:**` lines and a stray `v1.398.0` /
`**Last updated:**` pair mid-section, all of it from parallel PRs resolving the same shared line —
and gains one paragraph, written as a single long line in the section's current house style.

**`docs/implementation-backlog.md`** falls 14 as BF-39's entry is removed on shipping and LB-30 is
filed, which is the queue working rather than a compaction.

**The baton was rewritten and then cut back to its baseline**, which is the part worth recording:
correcting BF-39's state cost more lines than the correction saved, so the "finding that should
change how you start" section was compressed from a heading plus three bullets into one paragraph,
and four gotchas were merged. **Nothing was dropped** — the fourth instance of the precondition
finding (BF-39's own) is now in there too, and it is the one that cost the most.
## 2026-08-31 — `projectOverview.md` 8446 → 8443, `docs/implementation-backlog.md` 13752 → 13743 (LB-28)

Both fall, and the projectOverview one is the note worth reading: the new status entry was **paid
for in the same section** rather than by raising the number. The BF-46 ①a paragraph from the day
before was rewritten as one long line in the style the rest of the section has moved to, which
freed nine — so the index gained an entry and lost seven lines.

Nothing was cut from that paragraph except restatement: the picker count, the shared write path, the
reproduction, the parent instrumentation and the precondition finding are all still in it, and its
journal link is unchanged.

**Re-derive both on the merge if #647 lands first** — it removes BF-39's queue entry and repairs
four lines of duplicated `**Version:**` debris in the same section, so the merged figures will be
lower than these. Take them from the merged documents rather than picking a side.

## 2026-08-30 — `docs/implementation-backlog.md` (BF-67 gets its answer, and a reason)

The owner answered the template-vs-context question — *"more like understanding what I did… ideally
we should try keep similar exercises so we aren't changing it up too much"* — which is recorded
verbatim because it moves the open question from *what does reference mean* to *what counts as a
reason to change*.

The two lines that grew the file are the ones that turn a preference into a constraint.
`personal_records` and `exercise_estimates` are both unique on `(user_id, exercise_name)`, so
**history follows the name, not the program**: continuity is what preserves the 1RM and the PR, and a
paraphrased name silently starts from zero. And name fidelity is not enforced — `generate-program`
looks muscles up by exact name and falls back to the model's own guess on a miss, which is the tell.
An LLM told to keep similar exercises is exactly the thing that paraphrases, so the entry now says
the route has to resolve generated names against the library before this feature can deliver
continuity rather than the look of it.
## 2026-08-31 — `projectOverview.md` 8443 → 8445, `docs/implementation-backlog.md` 13745 → 13679 (BF-60/61/62/63)

**A rise of two, and it is a rise rather than a trade.** The nutrition batch adds one status
paragraph and pays for none of it, because the section has no slack left that is this branch's to
take: the two paragraphs above it are hours old and the ones below belong to other agents. Two lines
for four owner reports, one of which corrects the fix its own entry proposed, is worth the ratchet
moving.

**The backlog falls 66.** BF-60 is removed outright — a tab rename with an e2e assertion on the
label owes nothing further — while BF-61, BF-62 and BF-63 are rewritten to their `Keep:` residue,
which is the **device check** in all three cases and nothing else. That is the protocol working
rather than a compaction: an entry that shipped but is not device-verified stays in the queue,
because that check is the outstanding thing.

(Re-derived on the merge: this branch was cut on top of #647 before it landed, so its first
figures were against that head rather than against `main`.)

## 2026-08-31 — `projectOverview.md` 8445 → 8468, `docs/implementation-backlog.md` 13679 → 13602 (BF-66)

**Twenty-three lines, and twenty of them are one Known-Issues row.** The voice fix is JS-only and
reaches the phone on the next deploy, so it is device-*unverified* rather than device-*blocked* —
which under the Canonical Runtime rule is exactly the case that has to buy a row rather than a
queue entry. The row names the five phrasings to say into the button and points at LA-37's row four
paragraphs above it, because they are the same button and want the same sitting; a reader who does
one and not the other has done half a check. The remaining three lines are the status paragraph.

**No slack was available to pay for it.** The three paragraphs under the status heading are hours
old and belong to other branches, and the Known-Issues section's nearest ⚠️ rows are all still owed
their own device passes, so there was nothing here this branch could honestly strike.

**The backlog falls by BF-66's whole entry.** Nothing is owed past the device check the row above
now carries, so the entry is removed rather than rewritten to a `Keep:` — the residue lives in
`projectOverview.md`, and duplicating it in the queue would make an entry that reads as open work.

## 2026-08-31 — backlog 13602 → 13698 and `docs/agents/state/tuning.md` 235 → 273 (the step-goal re-raise, and the measured stride)

**No new entry — Q-524 gains an amendment, because the owner re-raised a decision they had already
made.** That is the first thing the lines buy: a predecessor recommended *"just set it to 7,000"*
without checking, and 7,000 is `STEP_GOAL_BY_ACTIVITY.sedentary`, a population constant specific to
nobody. Q-524 has carried the real decision since 2026-08-19. The amendment says so, and the baton
now carries the procedural rule.

The rest is the two requirements the 2026-08-19 decision does not cover, and both are the kind that
get rediscovered expensively. **Provenance:** the manual editor and
`/api/nutrition-goals/recommend:326` write the *same column*, so *"if manual is set, it wins"* is not
evaluable and an AI review can silently overwrite a deliberate choice — recorded as a code shape, not
an incident, since the timestamps show they have not collided. **Personalisation:** a step is not
equal work across people (at 160 cm, 10,000 steps is 6.6 km against ~7.5 at 180), and the arithmetic
showing the whole 7k-vs-10k argument is worth **~55 kcal/day** is what keeps the decision at its real
scale.

Two ⛔ traps are worth their length because both are load-bearing and neither is obvious: a step goal
built to satisfy the whole `activeEnergyGoal` would demand ~19,000 steps/day, and an energy-derived
step goal makes the Activity Score's `steps` and `activeEnergy` contributors count the same walking
twice.

**Then the owner asked whether strap cadence could give their REAL stride, and it corrected the
amendment written hours earlier.** It can — `activity_logs` already stores distance, steps, cadence
and duration on one row — and the answer is **0.739 m against the height rule's 0.664, so the
estimate was 10.1% short and every figure above was understated.** A correction that replaces its own
numbers has to show its working or it reads as a contradiction, which is most of the added length:
two independent extractions agreeing to 0.3%, cadence reproducing recorded steps to +0.13%, and the
**r = −0.885 stride-vs-pace relation** that says a single constant is still wrong. The
**27–94% walk share** of daily steps is what bounds how much any of it matters.
## 2026-08-30 — `docs/implementation-backlog.md` (BF-69, exposure as a variable)

Long because the request arrives on top of storage that already exists and one decision that
invalidates everything after it.

BF-3 shipped the per-log `amount`/`unit`/`doseText` snapshot, and its own comment says it was built
so a dose could be correlated against resting HR. What the entry adds is that **nothing reads it** —
`supplementLogs` is absent from `health-trends`, `sleep-performance-correlation` and both ai-chat
analysis files — so this is a reader, not a schema.

The decision written at the top is that **a missing row is not a zero**. The owner's baseline week is
a request to record a real zero, and today "didn't take it" and "forgot to log" are the same absence.
Three options are laid out with the one that manufactures effects named as such. The repo has already
published a false coefficient from a data-shape mistake and left it standing for eleven days, which
is why this is a blocker rather than a caveat.

Two findings the request did not know about: `food_items` has no supplement link and the owner's food
log already contains supplement rows, so the "picked up from the nutrition log" hope is also a
double-count risk; and the "like a total calorie value" analogy needs adjusting, because doses do not
sum across substances — what transfers is the shape (one number per substance per day), not the
total.
## 2026-08-31 — backlog → 13683 and `docs/agents/state/tuning.md` 235 → 256 (the HRV tile question)

*(Backlog figure is from the final rebase — other PRs raised it while this branch was open. This branch's own delta is +17.)*

**No new entry — the growth is entirely a closed question and four traps.** The owner asked whether
HRV should replace resting HR on the Home tile. Measured, it should not: **restingHeartRate −0.491
against hrvBalance −0.331** vs the check-in, and the two contributors correlate **+0.751 with each
other**, so it is barely a choice between two signals at all. That goes on **TN-13** as a
do-not-re-open notice, because "try HRV instead" is the obvious next idea and re-running it costs a
session.

The baton lines are worth more than the entry. **HRV is the one baseline object in this codebase that
is roughly right** (stored sd 0.82× true, where temperature's is ~12×), which matters because every
other baseline finding this month has been a defect and a successor will assume this one is too. And
**it lags for a good reason** — the owner's HRV is up 6.21 ms while resting HR is down 2.87 bpm, so
77% of recent nights sit above baseline and a naive out-of-band alert would fire high-side.

Two of the lines are near-misses caught before publishing: **"% of nights above" measures the trend
on a trending metric** (HRV was nearly filed at +0.62 sd against BF-13, which stands at −0.01 sd by
its own method), and **the RHR baseline is fed `rhrLowBpm`, not `rhr_avg_bpm`** — the wrong column
reads +2.66 sd, a phantom temperature-scale defect in a second consumer. Third column/unit near-miss
in two days, which is why it is now a rule rather than a story.
## 2026-08-31 — `projectOverview.md` → 8485 and the backlog → 13708 (the four-tiles-at-55 screenshot)

*(Absolute figures are from the final rebase — other PRs raised the same two files while this branch was open. This branch's own deltas are +17 on `projectOverview.md` and +42 on the backlog.)*

Two rows from one owner screenshot, and the pair is the point: one 🔴 defect and one 🟢 "this is
working, here is why it looked broken".

**The 🟢 row exists so the question is not re-asked.** *"Everything is 55"* looks like a scoring
collapse and is not — the three scores normally sit 20 points apart and this was the 2nd tightest day
in 35, while the readiness value reproduces to 55.3 from its stored contributors with HRV and resting
HR carrying 15.8 of the 18-point drop. Without the row, the next session re-derives all of that from
scratch. It also records the permanent fact underneath: `previousNight.input` **is** the Sleep tile
and `activityBalance.input` **is** the Activity tile, so 22% of readiness is the two tiles beside it
and Body Battery's anchor is readiness — the screen corroborates itself.

**The 🔴 row is TN-18**, and it is short because the evidence is arithmetic: `0.519 / 1.714 = 0.303`
matches the stored contributor input to three decimals, which is Q-506's inflated sd and TN-6's low
mean visible in one frame, failing in opposite directions. TN-6a gated the readiness ladder and not
the deload banner — the surface the owner actually reads.

## 2026-08-31 — `docs/agents/state/tuning.md` raised, 235 → 257 (the four-tiles-at-55 traps)

Five entries, four of which are things a successor would otherwise re-derive from the same screenshot.

The one worth the lines: **`tempZ` and `temp_dev_c` are different units and disagreeing is expected**
— `0.519 °C / 1.714 °C sd = 0.303 z`, matching the stored contributor input to three decimals. That
was nearly filed as "two temperature truths, one night" before the sd was checked. The baton now says
so outright, along with the real finding it masked: TN-6a gated the readiness ladder and left
`ai-dynamic.ts:184` firing.

The rest are cheap tests that stop a false alarm: check the **spread** before believing the scores
have collapsed (they normally sit 20 points apart), and **reproduce readiness from its stored
contributors** before calling it wrong (2026-08-31 came to 55.3 against a stored 55).

## 2026-08-31 — `docs/implementation-backlog.md` → **14344** on the merge (LA-45 survives a conflict that was not the usual one)

The backlog conflict here was **an addition against an empty side**, not the two deletions CLAUDE.md
warns about — LA-45 is new and `main` had never seen it, so keeping HEAD was right where "keep
neither" would have deleted a freshly filed entry. This is what the rule's *read the headings before
choosing* is for, and the resolution asserts the other side is genuinely empty rather than trusting
the eye.

## 2026-08-31 — `docs/implementation-backlog.md` falls as LA-44 is struck

LA-44 is removed whole: **BF-71 (#681) built it** hours after it was filed, so the entry describes
work that exists. Checked before striking rather than assumed — BF-71's DEXA form takes a superset of
the fields LA-44 named, its RMR form takes what `personalRmr` needs, and it adds no `bytea`, which is
the one thing LA-44 said not to reverse.

**The three surviving references to it were rewritten, not left.** An entry can be deleted from the
queue in one edit and still be quoted as outstanding in three others — BF-2's banner said its outcome
was "unobservable until LA-44", which stopped being true the moment #681 landed. A stale pointer to a
struck entry is worse than the entry, because the next reader trusts prose over a queue they have to
go and search.

## 2026-08-31 — `docs/implementation-backlog.md` 14064 → **14089** (BF-2 finishes, LA-45 is filed)

Twenty-five net, and it is one new entry — **LA-45**, the display half. The engine now corrects the
body fat everywhere a number is derived from it and **no screen reads the corrected value**, so the
Health card shows 25.3 while the calorie goal is already computed from 28.5. Two figures disagreeing
on screen is worse than neither being corrected, which is why it is a queue entry rather than a note.

BF-2's own step banner paid seven back. It had been rewritten twice today as steps landed, and the
third version would have been a third "what is shipped so far" paragraph on an entry whose work is
finished; it is replaced by the two things a later session must not simplify — the per-consumer
correction, and the three separate payload fields.

What LA-45 does **not** compress is the seeding rule: display `bodyFatCorrected`, seed the log input
from `bodyFat`. Backwards, that lets someone overwrite their own measurement by saving a field they
never touched, and no test in the repo would notice.

## 2026-08-31 — `docs/implementation-backlog.md` 14017 → **14025** (BF-2 step 3 ships)

Eight lines, and they buy one thing: a standing "do not simplify this back" on the step-3 design.
Correcting inside `listBodyMetrics` looks obviously right — one place, no consumer can be missed —
and it is wrong for a reason nothing in the code says out loud, because the path runs through a
client edit sheet and a source rank. A future session that reads the per-consumer sweep as
duplication will refactor it and quietly destroy the raw archive. The entry now carries the reason
rather than the conclusion.

The step-1/2 block it replaces is gone, not appended to: it existed to say "nothing consumes this
yet", which stopped being true today, and leaving it would have had the entry contradict itself.

## 2026-08-31 — `docs/implementation-backlog.md` 14007 → **14017** (BF-2 steps 1–2 ship)

Ten lines on BF-2, and they are the ones that stop the next session mis-reading a half-built entry:
the calibration and its repository read are on `main` and **nothing consumes them**, so no goal, RMR
or panel has moved. Without that stated, a session reading "shipped" would look for a behaviour
change, find none, and go hunting a bug that does not exist.

The other half is the step-3 design question, recorded with its measurement rather than as a
to-do — `listBodyMetrics` has **22 call sites**, which is what makes "correct inside the read" both
attractive (a missed site becomes impossible) and dangerous (a read-then-write path would persist a
corrected value into the raw column). A number a successor would otherwise have to re-derive before
they could even frame the choice.

## 2026-08-31 — `docs/implementation-backlog.md` 13812 → 13845 → **14007** on the merge (BF-2 gets its plan, and LA-44 is filed)

Thirty-three lines net, and the whole of it is **LA-44** — two shipped engines (`dexa_scans`,
`measured_rmr`) with no entry surface, both tables empty in production, discovered while re-verifying
BF-2's premises. A finding that stayed in the plan instead of the queue would be a dropped finding,
so this is the mechanism working rather than drift.

**BF-2's own block paid for more than half of it, and every cut was material that had gone stale
rather than material that was long.** The pre-scan instruction block (*"⏰ THE SCAN IS 2026-08-27, AND
ONE THING MUST HAPPEN ON THE DAY"*) is entirely in the past — it happened, and the pair is confirmed
in production — so it is replaced by the one line still true of it: a future scan needs a same-day
weigh-in booked with it. The *"still needs a planning session"* line is superseded by the plan
existing. And the offset-vs-ratio argument was stated **three** times over — banner, bullet, trap —
which was right while it was open and is noise now the plan settles it; one statement is kept and the
other two point at §2.3.

**Re-derived on the merge**, as every raise on this file has been today — another PR had taken it to
13974 while this was open, so the merged figure is that plus this branch's net. Counting the merged
document is the only resolution that is true of it; picking a side would silently drop one PR's work.

**What was NOT compacted is LA-44's own body.** It has to carry the measurement (0 rows in each
table, and a grep that finds no client caller), the reason an engine-first split hides this class of
gap, and the `bytea` decision it must not quietly reverse — a shorter version reads as a UI nit
rather than as two working engines nothing can feed.

## 2026-08-31 — `docs/implementation-backlog.md` 13784 → 13762 → **13812** on the merge (LA-43 ships)

The queue gives back the twenty-three lines it took this morning: LA-43's entry is removed on
shipping, which is the protocol working rather than a compaction. **The baseline is lowered rather
than left with the headroom**, because unclaimed headroom is exactly how the next entry gets added
for free and the ratchet stops ratcheting.

**Re-derived once more on the merge**: another PR raised the same number to 13834 while this was
open, so the lowered figure and the raised one had to be reconciled against the merged file rather
than either side — 13812, which is the raise minus this branch's 22-line removal. A lowered baseline
conflicts with every concurrent raise by construction; that is the ratchet working, not friction to
avoid.

BF-67's `Needs: LA-43` bullet is rewritten rather than deleted. An absent target counts as shipped,
so the pointer would have cleared on its own — but the plan it links to reasons about a hole that is
now closed, and one thing genuinely changed for it: the resolver deliberately does **not** match a
subset, so a referenced "Barbell Back Squat" still will not reach "Back Squat". Leaving the bullet as
a bare dependency would have dropped that.

## 2026-08-31 — `docs/implementation-backlog.md` 13602 → 13625 → **13784** (BF-67's planning session)

Twenty-three lines, and all of them are one new queue entry: **LA-43**, the program generator
trusting the model's muscle guess on any name the library does not contain. That is what the backlog
is for, so the growth is the mechanism working rather than drift — a finding that stayed in a plan
document instead of the queue would be a dropped finding.

Paid for where it could be. BF-67's own block was cut back to a `Needs:` line and a sentence: the
plan holds the measurement (0 unmatched of 31 PRs and 39 programmed names, against a 149-row
library) and the build order, and restating either in the queue entry buys nothing a reader cannot
get by following the link.

What was **not** done is compressing LA-43 itself. It has to carry why the fallback contradicts the
comment three lines above it, and why a latent hole is still worth filing — a shorter version would
read as a style nit rather than as the silent history reset it actually is.

**Re-derived on the merge — three times — and every conflict was the right kind.** Three other PRs
raised the same number while this one was open (13673, 13714, 13754), so git surfaced a genuine
disagreement about one value rather than two unrelated edits — the case the entries README says
should conflict. Resolved each time by counting the merged file rather than taking either side, which
is the only number true of it: **13784** at the last resolution. The doc-size baselines also split
per file (LA-33), which is what kept a busy day's worth of concurrent PRs to the one document that
actually disagreed.
## 2026-08-30 — `docs/implementation-backlog.md` (BF-69 gets the owner's join, and two collisions)

The owner answered how the food log should reach the exposure series: attach supplements to a meal or
saved meal, and logging the meal logs the dose. Recorded verbatim, because it dissolves the
double-count by construction — one table, two entry points — and the rule that makes it work is worth
stating outright: a supplement attached to a meal writes a `supplement_logs` row and never a
`food_items` row.

What grew the entry is two collisions read out of `adapter.ts` rather than guessed. `logSupplement`
**re-stamps** rather than adds — its own comment says the row is one act of taking it — so a
meal-carried dose plus a hand-tick is one value, last writer wins. And `unlogSupplement` soft-deletes
the whole day with no notion of who wrote it, so deleting a meal would wipe a hand-logged dose. Both
are silent, and both are only visible from the adapter, which is the argument for putting them in the
entry rather than leaving them for the implementer.

Two in-repo rules are cited because they answer the obvious fixes: stored counters have all drifted
here, so the day's amount must be derived rather than accumulated; and the ranked per-field merge with
`source_map` is the existing multi-writer provenance pattern that `supplement_logs` lacks.

## 2026-08-30 — `docs/implementation-backlog.md` (BF-69's storage model is decided)

The owner took both recommendations, so the entry stops describing a choice and starts describing a
shape: a day's exposure is an amount derived from contribution rows, each carrying where it came from
(`manual` or `meal:<id>`).

Three reasons are kept rather than compressed, because each is the answer to an objection an
implementer will otherwise raise. Amount over tick is argued on **reversal cost** — amount → tick is
free, tick → amount means back-filling doses nobody recorded — not on richness. Contributions over a
`source` column is argued from the deletion bug: one shared row cannot have half of it removed.
And `source_map` is explicitly rejected, because it is the reflex answer to "multiple writers" in this
codebase and it is the wrong tool here — a rank ladder resolves competing claims about one truth and
would discard one of two doses that should add.

The consequences section exists because this is a schema change to a **synced** domain: the unique
constraint that has to go is load-bearing across the local table, the reconcile lists, the delta and
the push branch, and the entry says so with "never batch this one" rather than leaving it to the
sync rules to be remembered.

The two collisions stay in the entry, marked resolved, as the checklist a reviewer runs the
implementation against.
## 2026-08-31 — `docs/implementation-backlog.md` (BF-70, a picture dropped three times)

The owner reported one missing thumbnail. Tracing it found the image is fetched successfully and
discarded at three separate layers — the form model has no field for it, the entry contract has no
field for it, and the local write hardcodes `imageDataUri: null`. Each is listed with its file and
line because fixing any one of them changes nothing, which is the fact that decides how the work is
scoped.

The second finding came free and explains a number already in the backlog: `handleConfirm` stamps
`source: 'ai'` whenever the scan carries a confidence, and a barcode scan does — which is why BF-38
measured 3 rows with `source = 'barcode'` out of 221. Same line, so the two entries are batched
rather than left to conflict.

Also note the batch checker earned its keep here: `nutrition-ui-uplift` is Lane B and BF-70 is Lane
A, and it refused the mix rather than letting a batch become a PR that cannot ship as one.

## 2026-08-31 — `projectOverview.md` 8468 → 8493, `docs/implementation-backlog.md` 13754 → 13726 (BF-65)

**Twenty-five lines: a status paragraph and a Known-Issues row, and the row is the one that had to
be written long.** BF-65 is JS-only, so it reaches the phone on the next deploy and is
device-*unverified* rather than device-*blocked* — the case the Canonical Runtime rule says must buy
a row. What the row spends its length on is the thing a shorter version would drop: **the dataset
host is dropped by the sandbox's egress proxy, so every clip renders blank here**, and the way that
was established as the environment rather than the change was seeing the warm-up screen's own
untouched thumbnails fail identically. A row saying only "not device-verified" would leave the next
session to re-derive that, and the obvious first guess — that the new component is broken — is
wrong.

**No slack was available.** The status paragraphs above it are hours old and belong to other
branches, and the neighbouring ⚠️ rows are all still owed their own device passes.

**The backlog falls despite BF-65 staying.** The entry is rewritten to its `Keep:` residue — the
device check, and only that — which is shorter than the plan it replaces. It stays queued rather
than being removed because a clip that has never been seen moving is not finished.

(Backlog figures re-derived on the merge: four PRs landed while this branch's E2E ran, so the
branch's own 13602 → 13574 was against a base that no longer exists. The drop is the same 28 lines
either way.)


## 2026-08-31 — `projectOverview.md` 8493 → 8497 (LB-23, LB-30)

**Four lines for two status paragraphs, because one of them is a finding rather than a shipping
note.** CI went red on the exact test LB-30 was filed to describe, on the line the fix was already
written for — and the thing worth recording is that the same test **passes three times over
locally**. A session that reads only "flaky, fixed" will re-dismiss the next one; the paragraph
exists to say that a local pass is not evidence against a race that only a slow runner opens.

The backlog is not listed here: LB-23 and LB-30 were removed and BF-46 was rewritten to its `Keep:`
residue, but four PRs landed in parallel and the file's size is theirs more than this branch's, so
the number is re-derived on the merge rather than claimed as a delta.

**The baton was trimmed rather than raised.** The LB-30 gotcha earns a line; two older ones were
reflowed to pay for it, so the file sits back on 126.

## 2026-08-31 — `docs/implementation-backlog.md` 13762 → 13819 (LB-31)

**Fifty-six lines for one entry, and the length is the point.** LB-31 records a red `Tests` check
that took an hour to place, and most of that hour went into two hypotheses that turned out to be
wrong — a stale local fixture, then the fresh-CI-database difference. Both were tested and both are
dead, and the entry says so explicitly, because the next session's instinct will be to try exactly
those two first.

It carries two findings. The narrow one is a test whose precondition is destroyed by a persisting
side effect of the route it tests. The durable one is that `ci.yml` has no `push: [main]` trigger
— correctly, and for reasons written into the workflow — so nothing verifies the *combination* after
several independently-green PRs land together. Five merged during this PR's own CI runs. That
defect first appears on the next contributor's PR, on code they never touched.

## 2026-08-31 — no baseline change; LB-31 corrected in place after the re-run

The failed `Tests` job was re-run on the identical commit and **passed**, so the body-battery
failure is a flaky test rather than the red `main` the first reading of it suggested. LB-31 and the
`projectOverview.md` paragraph are corrected to say the weaker true thing, and the correction is
recorded here rather than made silently — the earlier framing went into a commit message and a PR
comment, and a session reading only those would go looking for a defect on `main` that is not there.

Both files came out roughly even (`projectOverview.md` 8497 → 8495, under its baseline), so nothing
is raised.

## 2026-08-31 — final figures after batching three Tuning PRs into one: backlog → 13974, `docs/agents/state/tuning.md` → 316, `projectOverview.md` → 8485

**The three notes above (TN-18 / four-tiles-at-55, the HRV tile question, the step-goal re-raise and
measured stride) were written as three separate PRs and landed as one.** Each raise stands on its own
reasoning; this line only reconciles the arithmetic, because each PR's stated "before" number was the
baseline at the time it was opened and `main` moved between them.

**Why they were batched, which is the durable part:** all three touched
`docs/implementation-backlog.md` and its per-file size baseline, so every merge staled the next one
and each lost the rebase race in turn — three attempts, three conflicts, no merges. The per-file split
(LA-33) removed the conflict between PRs touching *different* documents; it cannot help PRs touching
the *same* one. **A run of same-file docs PRs from one agent should be batched from the start** rather
than opened separately and rebased serially.

## 2026-08-31 — `projectOverview.md` → 8512, `docs/implementation-backlog.md` → 13967 (BF-65/LB-23/LB-30/LB-31 re-merged onto the Tuning batch)

**Neither number is this branch's delta; both are re-derived from the merged documents.** The two
sides each raised `projectOverview.md` and the raises are additive — this branch's four status
paragraphs (BF-65's clip, LB-23/LB-30, and LB-31's filing plus its correction) against the Tuning
batch's own — so the merged file is above both sides' baselines rather than either one's.

**The backlog falls on the same merge (13974 → 13967) even though the Tuning batch raised it**,
because this branch removes LB-23 and LB-30 outright and rewrites BF-65 and BF-46 down to their
`Keep:` residue. Two PRs moving one file in opposite directions is exactly the case a re-derivation
answers and a resolved-to-one-side hunk does not.

**The re-merge itself was not optional and not a CI trigger.** GitHub created no workflow run
repo-wide between 03:26 and 06:11, which swallowed this PR's third push: a run for that commit will
never appear, because Actions does not create one retroactively. The standing rule already requires
re-merging `main` immediately before a merge and re-confirming green on the *updated* head, and
`main` had genuinely moved by one commit (#670), so the merge is the work the rule asks for and the
run is a consequence of it. An empty commit would not have been.

## 2026-08-31 — second re-merge, final figures: `projectOverview.md` → 8516, `docs/implementation-backlog.md` → 14010

**Supersedes the 8512 / 13967 figures in the note above.** Those were correct for the merge against
`main` at #670; `main` then took #673 and #674 (the DEXA plan and the body-fat calibration) while
this PR's E2E job ran, so the numbers were re-derived a second time against the newer base. Nothing
about the resolution changed — both are still counted from the merged documents rather than resolved
to a side.

**The backlog still falls (14017 → 14010) and `projectOverview.md` still rises (8485 → 8516)**, for
the same reason as before: this branch removes two entries and cuts two more to their `Keep:`
residue, while its four status paragraphs are additive against the DEXA ones landing beside them.
The status section is newest-first and this branch merges after #674, so its paragraphs sit above
them.

**The durable note is about the re-merge treadmill, not the arithmetic.** A green CI result goes
stale while the run that produced it is still finishing: E2E takes about twenty minutes here, and
two PRs landed inside that window. Re-confirming green on the *updated* head is therefore not a
formality on this repo — the base can move twice between opening a PR and merging it, and it did.

## 2026-08-31 — `docs/implementation-backlog.md` (BF-71, and BF-42's numbers re-measured)

The owner asked which calorie estimate the budget uses. Answering it required production, not the
source: `measured_rmr` and `dexa_scans` both hold **0 rows**, and a grep shows no client code calls
either route — the storage and the API shipped without a way in. That is BF-71, and it is why BF-42
cannot even be verified today, which re-points BF-42's `Needs:` from BF-33 (shipped) to this.

The arithmetic is written out because it reproduces the screen exactly and that is what makes the
claim checkable: 71.45 kg at 25.2% → 53.4 kg FFM → Cunningham 1,524 → ×1.2 → −200 = **1,629**, the
number on the card. With the measurement stored, `personalRmr` would return ≈1,368 and the base would
read ≈1,442 — a **188 kcal/day** difference.

BF-42's own figures were amended rather than replaced: its 1,481 was Cunningham at the *test-day*
FFM and is still the right basis for the −156 residual, but its implied live gap was four days stale.
A prediction that tracks the scale is exactly what a stored figure in a backlog entry cannot do,
which is now said in the entry.

## 2026-08-31 — third re-merge: `docs/implementation-backlog.md` → 14056, `projectOverview.md` → 8516

**`main` moved a third time inside this PR's CI window** — #675 (the RMR clinical-entry entry),
docs-only. Both figures re-derived again from the merged documents; `projectOverview.md` is unchanged
at 8516 because #675 did not touch it, and the backlog still lands under main's baseline (14063 →
14056) for the same reason as the previous two rounds.

**The pattern is now worth naming, because it is not bad luck.** E2E takes about twenty minutes here
and docs PRs land every few minutes, so a green result is routinely stale before it can be used —
three times over, on one PR. Strictly re-merging and re-running the whole gate each time terminates
only because the landing PRs happened to be small; against a busier hour it would not. **What made
each round safe to keep short was checking what actually landed**: #675 changed no code, so the
green on `716cf0b3` was not semantically invalidated and only the mechanical checks — the backlog
ratchet and the resurrection check — could have been broken by the merge. That is the question to
ask before deciding how much of the gate to re-run, rather than treating every base move as
equivalent.

## 2026-08-31 — `docs/implementation-backlog.md` (BF-72, and BF-35/BF-70 corrected)

Three edits from one review session, all about a value that exists and does not arrive.

**BF-72** is a one-line root cause found from the owner's own phrasing — *"it starts as the meal with
the image, then breaks into its ingredients"* says the optimistic write is right and something after
it is wrong. The diary's hydration rebuilds each local row from the server response and omits
`savedMealId`/`mealGroupId`; a local upsert overwrites all columns, so the omission writes NULL, and
the next line re-reads and renders the stripped copy. Confirmed in production rather than argued:
11 rows carry both ids and resolve to six real meals, two of which are exactly the five loose rows in
the screenshot.

**BF-70** gains a fourth drop site, and it is the important one: `create-food-item.ts:68` reads
`s.imageDataUri` where `s` is `sanitiseNutrition(...)`'s numeric-only return, so the line is always
null while its comment asserts the value is present. That comment is why nobody caught it — the file
reads as the place the feature was implemented.

**BF-35's `Keep:` said the images were "stored and unseen"** and that was wrong; nothing stores them,
so the render it lists as owed would show the same placeholder. Corrected in place with BF-70 named
as the prerequisite, because building the render first is the wasted PR that line would have caused.

## 2026-08-31 — `docs/implementation-backlog.md` (BF-73, a second pass over BF-50's work)

Both halves of this report are re-reports of controls BF-50 already built, and saying so is most of
the entry's value. The capture tiles were raised 48 → 62 dp with the number taken from the artboard
under BF-28's parity rule, so "make them bigger" now means overriding the drawing — legitimate under
rule 2 (a later owner decision beats the artboard) but it has to be *recorded* as an override, or the
next parity sweep corrects them back and the owner reports it a third time.

The action pair is the same shape: BF-50 ④ renamed `Select` to `Delete meals` because the words were
the fix, and the owner now wants that control reduced to an icon. So the entry says the accessible
name has to carry what the label was carrying, and that the hit box stays 44 dp while the label
shrinks — the two ways this ships as a regression while looking like the request.

## 2026-08-31 — `docs/implementation-backlog.md` (BF-74/75/76, the nutrition review's second batch)

Three entries where the code changed what the report meant.

**BF-74** looked like a tap-target complaint and is not. `meal-detail-sheet.tsx` passes
`hideCloseButton`, so the photo's remove ✕ — `absolute right-0 top-0` — is the only ✕ on the screen,
in the corner every user reads as "close". That is a wrong-meaning problem, and the entry says so
explicitly because the obvious fix (make it bigger) makes an accidental hit *more* likely.

**BF-75** asked for a nutrition theme, and one already exists: `screen-palettes.ts` defines a
`nutrition` key and the tab renders it. What is black is every sheet, because `SheetContent` starts
with `bg-background` — the exact case CLAUDE.md's background rule names. The entry's weight is spent
on the hazard: that class is the app-wide primitive, so this must be an opt-in variant, and dense
sheets need the scrim treatment or the wallpaper eats the 4.5:1 floor.

**BF-76** is the owner asking for a sweep rather than a third individual safe-area report, which the
sibling-surface rule already wanted. It inherits BF-62's `vh`-includes-the-inset hypothesis as its
first pass, because that generalises to every sheet at once, and it requires the enumeration to be
produced *before* any fix — a sweep that fixes as it goes cannot say what it covered, which is how
the fourth report happens.
## 2026-08-31 — `docs/implementation-backlog.md` (BF-77, and BF-57 raised)

The owner asked to share meals with a partner. The entry's job was to notice that the feature is
already designed, half-built, and inert — `meal-label-render.ts:694` still calls
`encodeMealLabelToken(mealId)`, the owner-only token, so BF-57's shipped self-contained payload
reaches nothing and today's labels still only scan for their author. One line is the difference
between "not built" and "built and unreachable", which is why it is quoted in both entries.

The rest is the fork: *share a meal* and *have the same meals* are different products, and the
three-row table exists so the owner can pick on cost rather than on wording. Two things are written
down because they would otherwise be discovered late — a group library reverses the
copies-not-coupling principle the owner chose in BF-57 and again in BF-58, and it is the only option
of the three that carries a consent surface, since one person's food library becomes visible by
default.

The decision is reduced to a single question — *when your partner changes a shared meal, should your
copy change too?* — because that is the one answer that separates finished work plus a code from a
project with a membership model.

## 2026-08-31 — `projectOverview.md` 8516 → 8519 (BF-71)

**Three lines for one status paragraph, and the length inside them is the point.** BF-71 is the case
where the code was already right — routes, bounds, repository reads and a consumer that read them —
and the defect was that nothing called any of it, so two tables sat empty in production and no test
could fail for it. A shorter paragraph would say "DEXA and RMR entry shipped" and lose the part a
future session needs: that an empty table is a valid state, so this class does not surface on its
own. It also carries the measured 188 kcal/day, which is what turns the entry's forecast into a
result.

**No slack was available to pay for it.** The paragraphs above belong to other branches and are hours
old; the neighbouring ⚠️ rows are all still owed their own device passes.

**The backlog is re-derived rather than claimed.** BF-71 is rewritten down to its `Keep:` residue —
the device check, and only that — but two other PRs landed while this one was built, so the file's
size is theirs more than this branch's.
## 2026-08-31 — backlog raised to 14331 and `docs/agents/state/tuning.md` to 321 (manual-wins signed off on Q-524)

One owner decision, recorded where the work will look for it. *"Yes, manual wins — record that as my
decision."* That closes the half the 2026-08-19 decision left unstated: a hand-set step goal is
authoritative and no automated path may overwrite it.

The lines beyond the sign-off line are the four consequences, and they are there because a bare
"manual wins" under-specifies the build: the AI path may **offer** and may **fill** only while unset,
accepting a suggestion converts it to manual, and **clearing must return the goal to the derived
path**. That last one is the reason for the length — a one-way door would mean a bad hand-entered
number could never be replaced by a computed one, which is the failure this precedence otherwise
invites.

TN-17 gains a cross-reference saying its own gate is now fully clear, so nobody re-asks the owner.

## 2026-08-31 — `docs/implementation-backlog.md` (the nutrition cluster to the head, and three misclassifications)

The owner asked for the review's output organised and pushed up the queue. The reorder is the small
part; three findings came out of doing it.

**LA-44 was struck as a duplicate.** Lane A and BugFix filed the same finding within hours — no UI
for the DEXA and RMR tables — and BF-71 shipped the screen the same day, so LA-44's premise was
already false. Its two durable points do not die with it: the no-`bytea` rule belongs to BF-41's
extraction path, and the general shape it named (an engine-first split leaves the entry surface for
"later", and nothing fails when later does not come — no test breaks, no check goes red, the table
just stays empty) is worth more than the entry was.

**BF-42's `Needs:` was parking it behind a device check.** It pointed at BF-71, which shipped and now
sits in the queue only to be looked at on the phone — so the pointer blocked reading a stored value
behind verifying a form. Cleared, not re-pointed, and the entry now carries BF-71's measurement:
BMR 1328 / TDEE 1594 against 1485 / 1782 predicted, so the 188 kcal/day it forecast is confirmed.

**BF-57 was a `Keep:` and should never have been.** A `Keep:` means shipped, residue only, not new
work — and this entry owes an entire unbuilt surface. Classified that way it never headed Lane B's
work list, which is how the owner's most-wanted feature sat idle while the payload it needs was
already merged.

Both lanes now lead with nutrition. Each moved entry was diffed against `main` before the commit —
six of six byte-identical, BF-57 the one deliberate edit — because a reorder branch that has gone
stale is how shipped entries get restored.

## 2026-08-31 — `projectOverview.md` 8519 → 8522, `docs/implementation-backlog.md` re-derived (nutrition uplift batch)

**Three lines for one paragraph covering four entries, and the length goes on the two findings that
outlive them** rather than on what shipped. `min-h-[Npx]` being inert on a `<button>` explains a
comment already in the tree that describes a size which never applied, and BF-76's sweep concluding
the *opposite* of its own hypothesis is the kind of result a future session would otherwise re-derive
from scratch — including the reason no padding changed.

**No slack was available**: the paragraphs above belong to other branches and are hours old, and the
neighbouring ⚠️ rows are all still owed their own device passes.

**The backlog is re-derived rather than claimed, and the merge is why.** #682 moved the nutrition
entries to the head of the queue while this branch rewrote four of them, so the conflict was a MOVE
against an EDIT — my side held the updated entries and main's side of the hunk was empty because they
had gone elsewhere. Resolved by placing this branch's content in #682's positions and then
de-duplicating: BF-70 and BF-75 arrived twice, byte-identical. **Nothing differed between any pair**,
which is what makes the de-duplication safe to state rather than hope.

## 2026-08-31 — re-derived against #676: `projectOverview.md` → 8514, `docs/implementation-backlog.md` → 14336

**Both come in UNDER main's baselines**, and the reason is worth stating because it is not this
branch being small. #676 compacted the status section — it deleted BF-71's paragraph along with the
older BF-2 and BF-46 ones — while this branch was adding its own. The conflict was therefore a
COMPACTION against an ADDITION: keeping this side whole would have restored three paragraphs main
had just removed, on the one file whose entire problem is unbounded growth. Only the new paragraph
was kept.

**The backlog was the move-against-edit case again** (#682's relocation), and after resolution every
one of BF-70/71/72/73/74/75/76 and LB-32 appears exactly once, with the four rewritten entries
carrying this branch's headings rather than the pre-fix ones.

## 2026-08-31 — `docs/implementation-backlog.md` (BF-78/79, and BF-41 re-asked)

The owner asked to gather the personal-detail fields into one section. Tracing where they live found
a latent data-loss bug instead: `updateUserProfile` writes `displayName`, `heightCm`, `dateOfBirth`
and `weightGoalKg` unconditionally as `?? null`, while the other four columns are guarded by presence
checks — so it is a PATCH by name and a PUT by behaviour. `goal-recommendation-sheet.tsx:148` already
sends a one-field body, so accepting an activity-level recommendation should erase four columns
including the height the BMR fallback reads.

Production says it has **not** fired — the owner's row still holds all four — and that is recorded,
because "latent, one tap away" is a different priority from "already happened" and the entry should
not overclaim. It goes to the head of the queue on that basis.

BF-79 is the owner's actual request, and the entry's value is the argument that the split *is* the
bug's habitat: two editors of one row means each resends the other's fields, which
`edit-profile-sheet.tsx` documents itself doing. It also draws the line the request does not — weight
and body fat are measurements with a history, so they belong here read-only, or the consolidation
creates a second write path to `body_metrics`.

BF-41 gains the re-asked upload request. Two notes shrink it: BF-71's typed forms are now the confirm
target, so extraction prefills rather than needing a review screen; and the blood panel is the report
that actually justifies it at 58 analytes. The crop-before-upload rule is restated as the owner's own
words, with the specific reason it must be the default path rather than advice — the extraction call
is what sends the document to Google.

## 2026-08-31 — `docs/implementation-backlog.md` (BF-1 raised from the bottom of the queue)

The owner asked for the blood panel, and BF-1 was sitting near line 14,118 of a 14,300-line file
while the report it needs has been in the repo, de-identified, since 2026-08-27. Raised to second in
Lane A — behind BF-78 only, because a latent data-loss fix is smaller and outranks a new feature.

The note added to it does one job: say why it is startable today. The 58 analytes are already
transcribed, so the schema can be written from a real report with nothing further from the owner, and
the awkward shapes are already in that file — a `<0.2` that is not a number, one-sided and absent
reference ranges, free-text flags, a month-precision date.

It also records the sequencing argument that BF-71 settled by shipping: typed forms were right for
DEXA (~10 fields) and RMR (3), and are obviously wrong for 58 analytes. So this is the report that
justifies BF-41's extraction path, and if that path is built for one report first, it should be built
for this one.

## 2026-08-31 — `docs/implementation-backlog.md` (BF-41 moved beside BF-1)

The owner declined typing twice in a row, in consecutive messages, after BF-71 shipped the forms. The
note records both quotes because the pair is the point: one request is a preference, two in a row is
the feature. It also states the relationship plainly — the forms are the confirm step the extraction
lands in, not an alternative to it — so nobody reads BF-71 as having satisfied this.

Moved to sit directly after BF-1, which needs the same pipeline for 58 analytes and is the report
that justifies building it.

## 2026-08-31 — `docs/implementation-backlog.md` (BF-80, and the clinical values landed)

**BF-80** is the session's most severe report and the entry is mostly about the silence around it.
`error_events` holds three rows for the owner across three days and none of them is a blank screen,
while `app/error.tsx` exists — so a JS exception would have painted a fallback and filed a row, and
neither happened. That absence is what points at the WebView's render process rather than at the
app's own code, and `MainActivity.java` has no `WebViewClient`, no `onRenderProcessGone` and no
reload path: grepped, zero hits for `RenderProcess` anywhere under `android/`.

The entry ranks three causes and gives the two behavioural tells that separate them without a cable,
because "reproduce it with logcat" is not a thing the owner will do at 10% battery. It also says
outright not to fix it by reloading on `visibilitychange` — that hides the fault and costs the
instant-paint behaviour — and that whatever the cause turns out to be, it must file an
`error_events` row, since a total failure leaving no trace is why this went unreported for so long.

**BF-71 and BF-42** are updated from production rather than from intent: the owner entered the
results mid-session and both tables now hold them, so BF-71's device check is closed (the date picker
and decimal keypads work in Samsung's WebView, which was the entire risk) and BF-42 is verifiable for
the first time.

## 2026-08-31 — `docs/implementation-backlog.md` (BF-81 and BF-82)

**BF-81** answers a question — *is the stress indicator working?* — with production rather than
reading. It runs: 18–29 buckets a day, levels using the full [−1,+1] range. But two producers write
the same metric and disagree on **8 of 8 days measured**, with the sign flipping on five and
high-stress minutes differing 4–9× (120–270 vs 0–60). The rollup's own comment claims this hazard was
settled by writing from one place; `body-battery/route.ts:349` still writes the other value. A
documented invariant that the code violates is worth a table, which is why the entry carries one.

It also records the thing that cannot be fixed: Oura's own `stress_high` exists on 10 days ending
2026-07-07, the re-key date, and our derived stress starts after it — **zero overlap days**. The
comparison the owner asked for is not available and never will be, so validation has to come from
somewhere else.

**BF-82** is the More page. The structural finding is countable: seven `MoreRowGroup`s holding one
row each, plus one entry (Goals) that expands inline while the other six navigate. The entry also
corrects the request's premise — there are no sliders on that screen, only five `Switch` toggles that
are correct for booleans, and what is probably meant is the goal-value boxes in the Goals accordion.
Saying so prevents a swap made for the wrong reason.

## 2026-08-31 — `docs/implementation-backlog.md` 14415 → 14438 (BF-57 shipped, LB-33 and LB-34 filed)

**Net +23, and it is two additions against one large deletion.** BF-57's 49-line work order — four
numbered scope items, the payload history, the raised-2026-08-31 note — collapses to a 22-line `Keep:`
entry now that the surface is built: what survives is the two-phone verification that is genuinely
owed, plus the measurement that reversed the entry's own item 1, kept because it is the answer to
*"why not just make every label shareable?"* and that question will be asked again.

Against that, two new entries. **LB-34** — a shared label scanned twice makes two copies of the meal;
found while building BF-57 and filed rather than folded in, because `findDuplicateMeal` already
answers the question and what the *offer* should say in a one-tap kitchen flow is a product decision.
**LB-33** — `meal-label-render.ts` reached 1,049 lines and `check-component-size.js` cannot see it,
because the file is `.ts` rather than `.tsx`. Both are the "no orphaned findings" rule doing its job:
each was noticed inside a diff that had no business absorbing it.

`projectOverview.md` stays at **8514** and is not raised. Its BF-57 paragraph was written at five
lines and cut to four, and the engine-half paragraph gave back an orphaned link line — the index
carries the fact and the pointer, and the reasoning lives in the journal entry where it belongs.

## 2026-08-31 — `docs/agents/state/implementation-lane-b.md` 126 → 141 (BF-57's state, minus most of the last run's)

**A baton is the one document where content is the deliverable**, so it grows when a run produces
state — and this one produced a whole feature area plus four gotchas that each cost real time (the
`DATABASE_URL` Playwright prefix, a source guard matching a comment that documents its own fix, and
a default argument quietly turning an assertion into a tautology).

**Most of it was paid for rather than added.** The previous run's three narrative paragraphs — the
`min-h` finding, BF-71's caller gap, the exercise-clip proxy — were rewritten at roughly half their
length, and the device section's per-screen enumeration was cut because
[`device-verification-queue.md`](device-verification-queue.md) is the document that holds it. Raw
addition was ~30 lines; the net is 15.

The rule this obeys is CLAUDE.md's: *"**rewrite** `docs/agents/state/<agent>.md` in full. Never
append; a baton that is half last week's is worse than none."* The ratchet is what makes that
rewrite happen instead of being intended.

## 2026-08-31 — `docs/implementation-backlog.md` 14438 → 14456 (BF-82's plan pointer and the corrections that go with it)

**All 18 lines are inside BF-82**, and they are the two fields the protocol says belong there rather
than in prose. `Needs: BF-79` is the sequencing the entry already stated in a paragraph — which is
exactly why `next-item.js` offered BF-82 as READY at the head of Lane B while the content half it
depends on sat PARKED behind a Lane A item. `Plan:` points at the document, so the planning half is
visibly done and the next implementer reads the plan instead of re-deriving it.

The rest is three corrections written **into** the entry rather than left only in the plan, because
the entry is what a hand-scan finds: the navigate-vs-expand affordance already exists, the real
defect is `goals-section.tsx` re-implementing `MoreRowGroup`, and Goals staying inline is a
2026-08-16 owner decision rather than an oversight. An entry whose premises are wrong is a work order
for the wrong work.

## 2026-08-31 — `projectOverview.md` 8514 → 8519, `docs/implementation-backlog.md` 14456 → 14448 (BF-75)

**The backlog SHRANK by 8** and the ratchet took it, which is the mechanism working: BF-75's 33-line
work order became a 25-line `Keep:` once the surface shipped, carrying the contrast check that is
genuinely owed plus the two things the entry did not know — wallpapers ship `enabled: false`, and a
translucent sheet reveals the overlay rather than the tab.

**`projectOverview.md` goes up 5, and most of the new paragraph was paid for rather than added.**
BF-57 had two paragraphs, one per half, which was the right shape while the surface was missing and
is not now that both have shipped — they are one paragraph with two journal links, which gave back
two lines. The remaining five are BF-75's own, and an index that cannot afford a line for a shipped
user-visible change is an index that stops being read.

The two findings in it are there because they are the ones a future session would otherwise
rediscover the hard way: the z-order that makes transparency impossible, and the default that makes
the whole feature invisible in the sandbox.

## 2026-08-31 — `docs/implementation-backlog.md` 14448 → 14464 (BF-52's plan pointer, and the instruction it declines)

**All 16 lines are inside BF-52**, and they are there rather than only in the plan because the entry
is what a hand-scan finds. Two of them are the `Plan:` field. The rest are a sharpening and a
reversal, both of which a future implementer would otherwise take at face value:

The photo and URL affordances are **mutually exclusive renders of one slot**, not two separate
discoverability problems — so making either findable means taking both out of it. And BF-52 instructs
the implementer to absorb BF-63's barcode button into the new capture row; the plan declines, because
photo and URL produce a whole ingredient list while the barcode and the estimate produce one
ingredient, and a barcode under *"start this meal from"* promises something it cannot do. **An
instruction that is quietly not followed is worse than one that is argued with in writing**, which is
why the strike-through and the reason live in the entry.

## 2026-08-31 — `projectOverview.md` 8519 → 8526, `docs/implementation-backlog.md` 14464 → 14442 (BF-52)

**The backlog shrank again** — BF-52's 46-line work order became a 25-line `Keep:` once the surface
shipped. What survives is the device check that is genuinely owed, the instruction the plan declined
(so nobody re-adds the barcode believing it was an oversight), and the two things found while
building: the URL branch is a **guard** rather than a convenience, and `runRecipeImport` became
testable only because two callers forced it out of a component.

**`projectOverview.md` goes up 7**, which is one paragraph for a shipped user-visible change. Nothing
was compacted to pay for it this time; the two BF-57 paragraphs were already merged earlier today and
there is no other slack in that section that is not load-bearing.

## 2026-08-31 — `docs/agents/state/implementation-lane-b.md` 141 → 159 (the nineteenth Lane B run)

Five PRs merged under this baton (#692–#696), and the run produced more transferable finding than
code. The block that grew is the one worth the lines: **seven tests across two runs that could not
fail as first written**, each named with its mechanism — a hit-test defeated by
`pointer-events-none`, a floor test using a weight where the floor was a no-op, three source greps
matching their own explanatory comments, and two from the run before. A successor who reads only that block and mutates
their guards has taken the whole lesson.

**Paid for where it could be.** The standalone *"finding that should change how you start"* section
was folded into it — it made the same point with three of the same examples, which is exactly the
duplication a rewrite is supposed to remove. The device narrative was compressed to a bulleted list
even while gaining three items, and one gotcha was retired into the new block.

The rule this obeys is CLAUDE.md's: **rewrite the baton in full, never append.** The ratchet is what
turns that from an intention into a thing that happens.

## 2026-08-31 — `docs/implementation-backlog.md` 14442 → 14509 (LA-47 filed, Q-407 parked behind it, LB-12's second missing field)

**Net +67, and none of it is new work discovered — it is one entry's halves being separated so the
queue can serve them.** Q-407 said in prose that `lib/coach/**` is Lane A and that *"the schema
change lands first"*, and was nonetheless row 1 of Lane B's READY list. Verified against main rather
than taken from the entry: `CoachWidgetSchema` is a union of five widgets with **no plan card**, and
`grep -rn scope lib/coach/*.ts` finds **no named scope record**, so Lane B's half had nothing to
render. LA-47 is that engine half as an entry someone can pick up; Q-407 now carries `Needs: LA-47`.
Same defect as BF-82 two entries earlier, and the same fix: **a field, not a paragraph.**

**LB-12 gained the finding that it is itself an instance of.** Its remaining half is the
Orchestrator's — it says so — and it heads Lane B's queue anyway, because `laneFromLines` reads
`**Lane:** B filed it; the sweep is the Orchestrator's` as a plain `B`. The queue's vocabulary is
`A`/`B`/`?`/unstated and **none means "classified, and not an implementer's"**. Recommended a
`Role:` field; not built, because `scripts/**` is the Orchestrator's own tooling.

**One thing caught by running the tool rather than reading the diff:** LA-47 was drafted with a
`- **Reference:**` bullet pointing at Q-407, which claims a FIELD meaning *"there is nothing to build
here"*. It printed under `REFERENCE (1) — read by other entries, not implemented. Never "next".`
The pointer is prose now. A backlog edit is worth running `next-item.js` over.

## 2026-08-31 — projectOverview.md 8526 → 8535 (+9)

Q-410's Known-Issues row, on `feat/walk-cadence-pacer`. The guided walk's pacer shipped and only
one of its three signal rungs has ever executed — the other two need a Polar H10 over BLE, which
the sandbox does not have. The row states what was checked, what was read rather than run, and
which two entries hold the remainder (LB-36 for the device pass, LA-48 for the per-segment
storage). That is index material by the file's own definition: it is the thing a session needs to
know before it believes the pacer works. The build detail lives in the journal entry and
`docs/module-map.md`, not here.

## 2026-08-31 — projectOverview.md 8535 → 8543 (+8)

Q-187's Known-Issues row, on `feat/meal-plan-day-fill`. The plan card can now fill the day in one
tap, and the row states the three things a session has to know before trusting it: that the offer
stops at the current hour on purpose (and why that is the design rather than a nicety), that the
device write path has not run because `getLocalStore` is null on web, and that Q-354 silently
swallows `locator.click()` on this screen — which is a trap for the next spec author, not a
user-facing bug. The build detail is in the journal entry and `docs/module-map.md`.

## 2026-08-31 — projectOverview.md 8543 → 8548 (+5)

LB-34's Known-Issues row, on `fix/shared-label-rescan-duplicate`. A re-scanned shared label no
longer duplicates the meal, and the row exists for what the fix could not be shown to do: the
branch needs a camera, so nothing here has ever scanned a real label. It is guarded at the source
and by unit tests, mutation-checked, and never executed from a scan — which is exactly the kind of
claim a session has to be able to read before it trusts the feature. The build detail is in the
journal entry.

## 2026-09-01 — `docs/implementation-backlog.md` (BF-83 and BF-84)

**BF-83** is two screenshots of the same night four minutes apart, and the table is the entry: every
number moved, *including the 30-night average it is compared against*. Production holds the later
version. Two mechanisms fit — a still-draining night, or a stale client cache — and `updated_at`
cannot separate them because all four rows share one bulk-pass timestamp and this repo has already
recorded that a bulk job bumps that column without rewriting a value. So the entry names the
one-morning measurement that does separate them rather than picking.

The recommendation holds under either: revalidate on open, and mark the night provisional until the
ring reports a wake. That is the repo's own partial-day rule — the one written from the Oura
`wornHours` mistake — arriving on a new surface, and the moving baseline in the table is it happening
in front of the owner.

**BF-84** looks like a button and is a persistence decision. `lib/home/rest-day.ts`'s own comment
says `/api/log-rest-day` persists nothing and rest is inferred from gaps, so today's choice is a
date-stamped `localStorage` flag: invisible to the other device, to a reinstall, and to every
server-side consumer that might act on it. The owner asking for it in a second place is the signal it
is deliberate, which argues for storing it — and that turns a Lane B control into a Lane A row. The
"per session" wording is also flagged as ambiguous, because Home shows one session and the request
only parses on a list.

## 2026-08-31 — implementation-lane-b.md 159 → 156 (−3, TIGHTENED)

The twentieth Lane B run's baton rewrite. It gained this run's material — `tsc` typechecking nothing
under `__tests__`, LB-38's two falsified hypotheses and the ship-the-instrument lesson, the queue
head being exhausted of Lane B work, and five new gotchas — and still came out five lines shorter,
because the rule is rewrite rather than append. The four-tests-that-could-not-fail block compressed
to its principle now the habit is established, and the re-litigate list lost detail that had aged
into background. Tightened rather than banked: slack left in a shrink-only ratchet is room the next
append takes without noticing. (Drafted at 154; the BF-84 line was then rewritten twice as #705
landed under it — first to stop asserting a state another open PR was about to change, then to
state the resolution it reached. Two lines, and the right two: a baton is read by someone who
cannot see which PRs were in flight when it was written.)

## 2026-09-01 — `docs/implementation-backlog.md` (BF-84's surface settled, and the button already exists)

The owner clarified: one small greyed Rest button on Home's training card. Reading
`recommendation-card.tsx` then changed the entry's shape — `onRestDay` is **already rendered** at
line 269, inside the `deloadOrRestRecommended` branch. So the handler, the `markRestDayChosen()`
write and the override are all built; what is being asked for is that the control appear when the app
has *not* suggested rest. That is a rendering condition, not a new control.

Which makes the surface work small and turns the persistence question into the whole entry: a button
that only appeared when the app volunteered it was used rarely, and one that is always present will
be used deliberately — while still writing to `localStorage` alone. The entry now says to ship the
button and the storage together.

Also records the emoji answer rather than substituting silently: the request was "rest + emoji", the
repo's convention is Lucide for chrome with emoji reserved for content carrying its own field, so
`Moon` is the same idea in the app's vocabulary and the owner should hear that.

## 2026-09-01 — `docs/implementation-backlog.md` 14442 → 14445 (+3)

BF-84's lane, derived and recorded once its surface was settled. Three lines to save every future
reader the same derivation: the entry says ship the button and the storage together, the storage
half is a row plus a sync domain plus the inference path, and a both-lanes item goes to Lane A
engine-first — so Lane B cannot take the surface alone. It also names the one question still open
(fact or hint) and what it would change, because an entry that looks startable and is not is the
thing this queue keeps costing sessions.

## 2026-09-01 — `docs/implementation-backlog.md` (BF-85, and BF-35 gets the owner's ask pinned to it)

**BF-85** is a centring complaint whose cause is legible from one line: the input carries
`text-center` and is a bare `type="number"`, so Chromium's inner spin button eats the right edge and
the text centres in what remains. The fix is already written in `quantity-editor.tsx:104` — the app's
other quantity control — which is the sibling-surface rule with the sibling right there. Two things
ride along: the input's `text-sm` is silently overridden by the `input { font-size: 16px !important }`
mobile rule that `quantity-editor` documents and works around, and 38 other `type="number"` inputs
have no spinner reset, which is recorded as a count rather than a sweep because some are in debug
consoles.

**BF-35** nearly got a wrong note. The owner's *"scan or barcode didn't add the item image"* reads as
BF-70, which I filed yesterday — but BF-70 **shipped** on 2026-08-31 and stores the thumbnail end to
end. So this is the unbuilt render at BF-35 (1), and the note went there instead. Two constraints
went with it: rows created before the fix are permanently imageless, so the placeholder is a
first-class state and not a loading shim, and the column holds bytes rather than a URL because it is
read local-first.

## 2026-08-31 — `docs/implementation-backlog.md` 14457 → 14506, `projectOverview.md` 8548 → 8557

`lane-a/sleep-provisional` (BF-83 engine half, BF-68). The backlog growth is three entries gaining
what they were missing rather than new entries: BF-83 and BF-68 each gained a `Keep:` stating the
half that shipped and the half still owed, BF-84 gained the `Gate: owner` its own prose already
argued for, and BF-80 gained the Capacitor-source finding (the `onRenderProcessGone` hook exists and
nothing registers it) so the next reader does not re-derive it. Removing the two shipped entries
outright would have deleted the Lane B obligations with them.

`projectOverview.md` is a net +9 against +12 added: the status section carried **two** `**Version:**`
lines, v1.413.2 and a stale v1.406.1 below it, and the second was removed.

## 2026-08-31 — `docs/implementation-backlog.md` 14506 → 14528, `projectOverview.md` 8557 → 8572

`lane-a/renderer-recovery` (BF-80). BF-80's entry traded its "deliberately not batched" paragraph
for a `Keep:` describing what shipped, so the backlog's growth is Q-220 gaining a measurement: the
`projectOverview.md` **Current Status** section is a 740-line log of **142 dated blurbs**, which
none of that entry's three levers touch and which the file's own header tells sessions not to write.

`projectOverview.md` grew by exactly the blurb this session added to that section — i.e. it is an
instance of what the note above describes, raised rather than hidden. Trimming it is Orchestrator's
sweep, not a native-fix PR's.

## 2026-08-31 — `docs/implementation-backlog.md` 14528 → 14730, `projectOverview.md` 8572 → 8586

`lane-a/coach-nutrition-scope` (LA-47 piece 2). The backlog growth is LA-47 recording that its own
proposed lane split for the plan widget **does not compile** — a new `CoachWidgetSchema` member is
a type error until `widget-registry.tsx` handles it, and a branch rendering `null` wedges the
thread — together with the settled widget design, so whoever pairs on it does not re-derive it.
Cheaper here than a second entry. Re-derived twice while the branch was open, in both directions:
LB-12 and BF-85 landing on `main` took more lines away than LA-47 added, and BF-86 then put more
back. Which is the argument for re-deriving from the merged file rather than splicing a number.

`projectOverview.md` is again the Current Status blurb, which is the growth the note added to Q-220
earlier today describes. Third raise of the evening from the same cause; the retention rule is
Orchestrator's sweep.
## 2026-09-01 — `docs/implementation-backlog.md` 14528 → 14507 (shrink)

`docs/bf55-owner-decision`. Two independent raises collided in this file and both are now moot. The
lane sweep (#708) raised it to 14521 for 52 added `Lane:`/`Gate:` fields; `lane-a/renderer-recovery`
raised it to 14528 the same day. Merging `main` in produced a conflict between those two numbers,
and neither is the count — the real file after both landed plus BF-55's gate-clearing is **14507**,
because #708 also struck LB-12 and main has since cleared entries the raises were sized against.

The pattern is worth stating once, since it has now cost two withdrawn raises: **a baseline raise
computed before a rebase is a guess.** Re-measure after merging `main`, not before, and expect the
answer to be lower than either side of the conflict.

## 2026-09-01 — `docs/implementation-backlog.md` 14507 → 14547

`docs/bf55-owner-decision`, second commit. Three entries gained the thing that was blocking them,
and in each case the missing piece was a number or a field rather than prose:

- **LB-37** asked outright for a count and said a session that measures it without recording it
  leaves the next one to measure again. It is **282 errors across 83 test files** (289 raw minus a
  7-error sandbox baseline that touches no test file). That decides the shape — a ratchet, not a
  one-PR fix — so the measurement is what makes the entry startable, not commentary on it.
- **Q-250** lost a `Gate: device` that was circular: the entry exists to *close* device-gated rows
  and was parked behind the bottleneck it relieves. Its replacement text is longer than the field
  it removed, deliberately, so nobody re-adds the gate.
- **Q-187** gained `Gate: owner` and a recommendation, because its lane genuinely *is* the pending
  decision and it was sitting in UNCLASSIFIED where both lanes saw it and neither could start it.

Both long blocks were cut roughly in half before this number was taken (LB-37 by 14 lines, Q-187 by
5); +40 is what remains after that trim.

**Amended to 14557 in the same PR (+10).** `LA-45` lost a `Gate: device` for the same reason Q-250
did: it was parking work nobody had built yet. The gate means *waiting on* the smoke run, which fits
a shipped entry; LA-45 is waiting on an implementer, and its stated reason — "a Health-screen change
on the canonical runtime" — is true of every Lane B item, so gating on it parks the lane. The
replacement text records that the other 39 device-gated entries were checked and **only this one is
of that kind**, so the next session does not re-audit all 40.

**Amended again to 14603 (+46).** Chasing LA-45 turned up that this file's field rules *already*
forbid `Gate: device` on unbuilt work, in terms, with three recorded outbreaks — so LA-45 was a
straggler under an existing rule rather than a new finding, and its note now cites the rule instead
of re-deriving it. The same audit found the identical failure one section over: `Keep:` routes an
entry into a **KEEP** heading reading *"not new work"*, and four of Lane B's twelve were builds,
including `Q-519`'s entire UI half. `Keep:` was documented nowhere, so that is now written into the
field rules (+9) and filed as **OR-100** (+33) with the split-and-enforce recommendation. `Q-519`
also lost a stale no-entry marker that was hiding it outright.

The growth here is the queue learning a rule it did not have. If OR-100 ships, the four split
entries will grow this file again — that is the correct direction, and worth saying now so the next
raise is not read as drift.
## 2026-09-01 — `docs/implementation-backlog.md` (BF-86, and the fix is three lines above the bug)

The owner asked for the app to reset itself on the first open of a new day, and gave the symptom that
explains why: the morning check-in does not appear on a resume. That half has an exact cause —
`session-select-content.tsx:784` prompts from an effect with deps `[userId, tz]`, neither of which
changes, in a tab shell that never unmounts. It runs once per launch. The same file already solves
this at `:774` with `tabEpoch`, and the check-in guard is already date-stamped, so re-running is
idempotent: the state is right and only the trigger is missing.

The entry spends its length refusing the requested implementation and saying why, because "close and
reset the app" is the kind of instruction that gets built literally. BF-80 — filed hours earlier —
says outright not to fix a resume problem with a reload, and a scheduled reload would give a blank
screen two candidate causes just as that one is being diagnosed. The recommendation is the mechanism
the repo already has in miniature: `workout-day-rollover.tsx` is a correct date-change signal wired to
exactly one consumer, and generalising it delivers the owner's ask with no reload at all.

Also records the scale (56 `cachedFetchToday` sites) and the boundary-test rule, because a rollover
bug is only visible across local midnight and this repo has repeatedly shipped date logic that works
all day and fails in a two-hour band.

## 2026-09-01 — `docs/implementation-backlog.md` (BF-87, a correct number nobody can explain)

The owner asked whether steps count toward calorie burn, and his own screenshot holds both halves:
1,196 steps beside "nothing earned from movement yet today". Both true, because `STEP_BASELINE` is
3,000 and only steps above it convert — the sedentary base is BMR × 1.2 and a desk day's incidental
stepping is already inside that multiplier.

So the entry is a copy fix, and its length is spent on the two ways it could be built wrong. Showing
the *shortfall* without the *threshold* leaves the same question one step later — the owner's goal is
7,000 steps, of which only 4,000 convert, and someone expecting all 7,000 to count will read the burn
as broken. And "fix" by lowering or deleting the constant is the tempting wrong move: it is the guard
against double-counting, and changing it silently re-scores every historical day, which is a Tuning
proposal with a stated blast radius rather than an implementation detail.

Also notes that `activeBreakdown` already returns all three addends separately, so a one-line
breakdown needs no new data.

## 2026-08-31 — `docs/implementation-backlog.md` → 14746, `projectOverview.md` → 8599

`lane-a/deload-temp-gate` (TN-18). The backlog growth is TN-18's `Keep:` recording two things the
entry could not have known: the fix needed the adapter's daily-summary read widened to 28 days, and
that widening turned `summaryRows[0]` from today into the oldest night — a month-stale deviation
feeding a deload banner, which the first version of the new test file did not catch.

`projectOverview.md` is the Current Status blurb again — the fourth raise of the evening from that
one section, which is exactly what the note added to Q-220 earlier today describes.
## 2026-09-01 — `docs/implementation-backlog.md` → 14708 (merge resolution)

`docs/bf55-owner-decision`, merging `main` after #714 and #715 landed. Both sides of this file's
conflict were kept, which is correct here and is the opposite of the backlog's rule: this file is
**append-only**, so a conflict is two *additions* and dropping either loses a note; the backlog's
conflicts are two *deletions*, where keeping both resurrects shipped entries. Same markers, opposite
resolution — read the headings before choosing.

The number is re-measured after the merge rather than carried across it, per the note above. The
entry-ID set was diffed against the new `origin/main`: **OR-100 added, nothing lost**, so the
auto-merge resurrected none of what #714 and #715 removed.

## 2026-09-01 — `docs/implementation-backlog.md` 14708 → 14761 (BF-88, an answer that had to be measured)

The owner asked whether dropping the step baseline for "RMR + steps + exercise" would be more
accurate. It reads as obviously right and it is measurably wrong: against 124 days of his own data
the proposed model gives a **lower** burn on **124 of 124**, mean −177 kcal, because the 0.2 × RMR
it deletes is worth 265 kcal while the 3,000 steps it gains are worth ~106.

The entry is long because the useful finding is not the answer but what the tracing turned up —
`STEP_BASELINE` means two different things depending on whether maintenance is calibrated, and in
the calibrated path it is nearly self-cancelling. One constant with two behaviours and no way to
tell them apart from the screen is how a reasonable proposal gets to look obviously correct.

It carries its numbers (124 days, 50 below threshold, 45 with plausible intake, the RMR of 1,325)
because the Tuning rule requires a blast radius and because the next session to be asked this will
otherwise re-run the same six queries.

## 2026-09-01 — `projectOverview.md` → 8606, `docs/implementation-backlog.md` → 14816 (BF-79)

**`projectOverview.md` 8572 → 8606, and BOTH numbers moved under it.** Main shrank the baseline to
**8586** in the same window (#713/#716) while this branch raised it to 8593, so neither side of the
conflict was the answer — the figure is recomputed from the merged document, like the backlog one
below. Two shipped changes had to be recorded and only one of them was this PR's: BF-85 merged in
#711 **without a status block**, so its paragraph lands here alongside BF-79's. Both blocks were
tightened twice before the raise; what is left is the two features and a one-clause mention of each
finding, with the detail in the backlog where it belongs. One of those findings, LB-40, is a live
bug on `main`.

**`docs/implementation-backlog.md` → 14816, recomputed three times.** Both PRs raised this one file, which
is the size conflict that is a real disagreement rather than two additions — resolved by recomputing
from the merged document, never by taking a side. BF-79's own share is **+27**: net of removing the
shipped BF-79 entry (43 lines) and adding LB-40/41/42 (76). LB-42 is the long one deliberately: it has to say which column each reader
uses before anyone can choose which survives, and that is the whole of the decision it is asking
for.

**And `docs/overview/entries/` crossed its 250 total ceiling** at 251, which is a failure rather
than the chore *note* it prints at 20 foldable. So the compaction sweep ran in this PR: the 22
oldest **unlinked** entries folded into `history-2026-08-30.md` (110 KB → 184 KB), leaving 229
total and 21 foldable. Linked entries were left alone — a durable doc citing a folded path is a
broken link, which is how the first sweep broke 48 of them.

Nothing was banked. The alternative to raising was leaving a shipped feature unrecorded in the file
every session reads first, which is the failure the ratchet is not for.


## 2026-09-01 — `docs/implementation-backlog.md` 14816 → 14861 (+45)

`docs/owner-decisions-2026-09-01`. Three owner gates cleared in one sitting, and the growth is the
decisions themselves rather than new work: **BF-84** (rest is a stored fact, not a display hint),
**Q-187** (spread the overshoot, at read time, with a floor) and **Q-531** (the device consoles go
back behind `/admin`, and the layout was handed back to the implementer).

Each records the owner's own words and the reasoning, because two of the three were answered with
*"whatever is better in the long run"* / *"wherever you want"* — a call handed back with a criterion
attached. Writing only the verdict would leave the next reader unable to tell a decision from a
preference, and this queue has already re-litigated settled questions that way.

`Q-187` also gained an explicit **not-in-scope** bullet: the owner asked for the choice between
spread and next-meal-only to be offered as an option, and that is deferred to its own entry until
the spread version has been lived with. A preference shipped alongside the behaviour it toggles has
no evidence behind either branch.
## 2026-09-01 — `docs/implementation-backlog.md` → 14832, `projectOverview.md` → 8619

`lane-a/deload-temp-gate` (TN-18), re-derived after merging a `main` that had moved five times while
the branch was open. Both numbers are the merged files counted, not a spliced arithmetic — which is
the only way to get this right when the other side is also growing.

## 2026-09-01 — `docs/implementation-backlog.md` → 14877 (merge resolution)

`docs/owner-decisions-2026-09-01`, merging `main` after #719. Re-measured after the merge rather
than carried across it, and both sides of this file's own conflict were kept — it is append-only, so
a conflict here is two *additions*, the opposite of the backlog's. Entry-ID set diffed against the
new `origin/main`: **identical, nothing added or lost.**

## 2026-09-01 — `docs/implementation-backlog.md` 14877 → 14892 (+15)

Same branch, second pass: an audit of the 11 remaining `Gate: owner` entries for the failure the
Orchestrator baton warns about — *a decision the owner already made, with the gate left on*. Three of
eleven had it.

- **Q-540** carried `Gate: owner` on the line directly above *"✅ UNBLOCKED 2026-08-17"*, and was
  then superseded by its own 2026-08-25 re-measurement (Q-541's packing made the table it narrows
  stop growing). It becomes `Reference:` — the measurement stays findable, the runner stops offering
  work the entry argues against.
- **Q-4** and **Q-71** are owner *actions*, not decisions: consent for the first was given
  2026-08-04, and the second's decision plus its re-scope condition were both settled by 2026-08-12.
  Both are cross-linked into `device-verification-queue.md`, which is the list the owner actually
  works from — a settled decision wearing a decision-gate is invisible there.

The growth is three entries gaining the sentence that says why they are not what their field claims.
## 2026-09-01 — `docs/implementation-backlog.md` → 14895, `projectOverview.md` → 8631

`lane-a/one-weight-goal` (LB-42). The backlog growth is the entry recording the half that did NOT
ship and why: `weight_goal_kg` is retired but **not dropped**, because dropping is irreversible and
the row-scoped audit view cannot show other accounts' values, so what would be lost cannot be
checked first. Left as prose rather than a `Gate: owner` field, since the entry's work is done and
only the deletion is owed.
## 2026-09-01 — `docs/implementation-backlog.md` 14783 → 14803 (BF-87 gains the rate it was missing)

Same entry, sharper requirement. Told the model was correct, the owner restated what he actually
wanted: *"i would like to see steps = calories so I know roughly how much effort translates to how
much."* BF-87 had argued for showing the *threshold*; the ask is the **rate**, and those are
different deliverables.

The growth is a measured table — 1,196 → 0 kcal through 15,000 → 407, driven through
`computeActiveEnergy` rather than approximated, so an implementer can check against it instead of
re-deriving Schofield by hand. Plus the trap it implies: "steps = calories" is two numbers here, and
a single rate is wrong below 3,000 — where 50 of the owner's last 124 days sit. Shipping the bare
rate would move the confusion rather than fix it.

No new entry, because this is the same piece of work and BF-88 already points at BF-87 with
`Needs:`. Splitting it would have made two entries that must be read together.

## 2026-09-01 — `docs/implementation-backlog.md` 14803 → 14831 (BF-88 gets a decided change, BF-87 loses a stale ban)

The owner's second proposal is not the one measured and rejected an hour earlier. *"cant we remove
some calories for the base 3000 and have it start from 0 steps?"* **conserves** where the first
deleted: it subtracts exactly the 102 kcal it hands back, so every day at or above 3,000 steps
reports an identical total and only the 50 sub-3,000 days move, mean −43. The first version cost
−177 on all 124.

So BF-88's recommendation is replaced rather than appended to — "leave both constants alone" is no
longer the advice, and leaving it beside the new one would let an implementer pick either.

The growth is mostly two hazards that a reader would otherwise hit: the subtraction is **computed
per profile** (102 is the owner's number, and the app has more than one account now), and the two
paths need **opposite** treatment — the calibrated path self-corrects, so applying the subtraction
there double-subtracts it. That second one is BF-88's own finding turning out to be load-bearing
rather than descriptive.

BF-87's "do not lower STEP_BASELINE" is rewritten in the same pass. It was correct about the
uncompensated version and would have made an implementer refuse the compensated one — a stale
prohibition being obeyed is the failure mode that needed closing in the same diff that created it.

## 2026-09-01 — `docs/implementation-backlog.md` → 14977

`lane-a/keep-kind` (OR-100). The growth is OR-100 recording that it undercounted its own problem:
the entry measured **4** buildable `Keep:` residues on one lane, and the classifier finds **13**
across the queue — two of them written by the same session that then built the check. Also records
the second drift found on the way (`check-backlog-pointers.js` carried its own `Keep:` regex and
missed 11 entries `lib/keep.js` sees), so the next reader does not re-derive it.
## 2026-08-31 — backlog raised to 14551 , `docs/agents/state/tuning.md` to 338 and `projectOverview.md` to 8524 (TN-19, the battery explainer)

One entry, from the owner's second report on this pillar in six days. The length is the five-row
table, and the table is the entry: the card names five mechanisms and **four are inert or backwards**
— `Deep sleep` cannot fire at all, `Calm rest` produced 6 points in 8 days, `Training` moves the
number 0.6 points, `Daytime stress` rises on good days. Naming them one at a time is what stops the
fix being "reword the card", which would document the defect rather than repair it.

The entry also carries the distinction that makes it worth filing separately from TN-15: **a wrong
number the app explains is worse than a wrong number it does not**, because the explanation converts
a vague doubt into a demonstrated one. That is why this pillar reads as unusable rather than merely
miscalibrated, and it is not something TN-15's own text says.

## 2026-09-01 — `projectOverview.md` → 8656, `docs/implementation-backlog.md` → 14978 (BF-87)

One shipped change recorded, and one entry filed. The status block is 12 lines because the 500 is
the part a future session needs: **no client component had ever imported `daily-energy`**, so the
`node:fs/promises` chain behind it had never been tripped, and the next person who wants a constant
out of it will hit the same wall. The backlog grew by LB-43, which is that fix, minus the removal of
the shipped BF-87 entry.

## 2026-09-01 — `docs/implementation-backlog.md` → 14991 (BF-1's plan pointer)

`lane-a/blood-panel-plan`. BF-1 gained the link to its implementation plan plus the findings that
drove the schema — that `<0.2` is a result which is not a number, that reference ranges arrive in
four shapes, and that the flag is commentary sitting on values inside their range, so out-of-range
has to be derived. Those belong on the entry rather than only in the plan: the entry is what an
implementer reads before deciding whether to start.

Also carries two owner decisions taken in the same session, recorded on their entries rather than
left in a chat: **BF-59** — label a peaking week, do not scale the target, because nobody has
calibrated a per-phase multiplier and the owner's sessions span three phases at once; and
**BF-81** — leave the 38 mixed-producer rows alone, since re-deriving the 8 that can be re-derived
would leave 30 on the old producer and make the column's provenance harder to reason about, not
easier. BF-84's *fact or hint* was asked too and turned out to be **already answered** in a PR that
merged while this branch was open — the answer matched, and nothing needed changing.

## 2026-09-01 — `docs/implementation-backlog.md` → 15013, `projectOverview.md` → 8668 (LB-43)

The backlog growth is LB-43 recording the two things its own text could not have known: the leaf
module it proposed creating **already existed** (`energy-baseline.ts`, built for the identical
failure one node builtin earlier), and the drift test guarding the mirror became **tautological**
once the mirror was deleted, so it was replaced rather than kept. Both belong on the entry: the
first stops the next reader creating the duplicate file, the second explains why a test changed
shape in a PR that was supposed to only move constants.

## 2026-09-01 — `docs/implementation-backlog.md` 14977 → 14986 (BF-88 approved: gate cleared, order swapped, dependency inverted)

The owner approved the compensated shift — *"yes that sounds good lets ship that"* — so BF-88's
`Gate: owner` is cleared and it becomes Lane A's #1 READY item. Three edits, and the growth is
almost entirely the third.

The gate line is replaced by a **DECIDED** line carrying the owner's words and the blast radius the
sign-off was given against, so the approval and what was approved cannot drift apart.

BF-88 moves above BF-87 in the queue, and **the `Needs:` between them inverts**. That is the part
worth the words: BF-88 waited on BF-87 while it was only "make the path legible", and now that it
changes the model, the copy waits on it. Shipping BF-87 first writes *"steps count above 3,000"* onto
a card BF-88 is about to make count from zero — a wrong sentence within a release, on the exact
screen BF-87 exists to make trustworthy. The inversion is explained in the entry rather than just
performed, because a reader who remembers the old direction will otherwise assume it is a mistake.

## 2026-09-01 — `docs/agents/state/bugfix.md` 205 → 244 (a session's state, after two rounds of putting things elsewhere)

The first draft was **57 over** and the check was right to refuse it: most of it was narrative about
how the owner's three questions improved, which is journal material. That went to
`docs/overview/entries/2026-09-01-energy-model-intake.md` and the baton kept the state — decision,
numbers, the inverted `Needs:`, what the owner still owes. **−16 lines.**

The second pass fixed a structural mistake rather than a size one. Four lessons had been prepended
into *"What this session learned that the traps list did not already say"* — a heading that names a
**different** session, so two sessions were merging under one title. Three moved to **Method notes
worth reusing**, which is the permanent section they were always for; the fourth is a trap and folded
into the existing stacked-PR bullet, which already covered the marker-conflict case and now covers
the clean-auto-merge case that actually fired this session. **−2 lines, and the file's own structure
holds again.**

What is left is a session's state block and three method notes, which is what this file is for. The
baton rule is *state only, rewritten in full* — the accretion this check catches is exactly what that
rule exists to prevent, and it caught it twice here before the number moved.

## 2026-09-01 — `docs/implementation-backlog.md` 14978 → 15011, `docs/agents/state/bugfix.md` 244 → 251 (BF-87 won the race; BF-88 absorbs the consequence)

The dependency inversion filed an hour earlier existed to stop BF-87's copy being written against a
threshold BF-88 removes. **It lost the race** — Lane B merged BF-87 (#725) first — so this PR stops
being a reorder and becomes a correction.

Most of the backlog growth is two warnings inside BF-88, and the second is the one worth the lines.
Three shipped sites now print *"steps above 3,000/day"*, and rewriting them is in BF-88 rather than a
follow-up, because a follow-up is how a card ships a false sentence for a release. **And the guard
BF-87 shipped cannot catch the falsehood**: the constant is mirrored into a client module (LB-43 is
why — importing `daily-energy` 500s the Nutrition tab) with a test pinning the two values equal, and
BF-88 can leave the value at 3,000 while changing what it *means*. Equal value, green test, false
copy. The entry now asks for the rename that breaks every consumer on purpose.

The baton and the journal entry both carried the old claim that the inversion protected BF-87. Both
are corrected in the same diff rather than left to read as a success — the general lesson replacing
it is that **a reorder only protects work that has not started**.

## 2026-09-01 — `docs/implementation-backlog.md` 15030 → 15156 (three entries on why the owner is the bottleneck)

The owner asked whether tooling could lower his gate load. Measuring it first changed the answer:
**31 `Gate: device` against 10 `Gate: owner`**, and **11 of the 31 sit on work that already shipped**.
So the largest single win is a field split (BF-90) that costs no owner time at all — `Gate:` parks an
entry, which buries finished-but-unseen work behind the same wall as unstartable work.

BF-91 records the automation headroom and, more usefully, its two limits: a screenshot test catches
**change, not correctness**, and it is **blind to safe-area** because the web sandbox reports insets
as 0 — a green check over that class would be worse than none.

BF-92 is the entry this session did not expect to write. The owner said Sentry was connected and he
was right; **it is receiving nothing from the client**, for two independent reasons measured against
production — no `NEXT_PUBLIC_SENTRY_DSN` in the deployed bundle, and no ingest host in the served
CSP's `connect-src`. `instrumentation-client.ts:11` predicted the second in its own comment and the
host was never added, which is the durable lesson: **a comment describing a hazard is not a guard
against it.**

The length is mostly ordering and negative space — what not to do (no wildcard `connect-src`, no
session-start pointer at an empty dashboard) and what genuinely cannot be checked from here
(`SENTRY_DSN` is server-side and invisible from outside the deploy).

## 2026-09-01 — `projectOverview.md` → 8666, `docs/implementation-backlog.md` → 15133 (LB-40)

One shipped fix recorded; the backlog **shrank**, since LB-40's entry was removed and nothing new
was filed. The status block is 10 lines because the interesting half is not the bug but the
direction the fix fails in: `cachedFetch` swallows a failed request, so an unknown flag has to show
the field rather than hide it, or a cold cache plus a dead network silently reproduces the defect.
That reasoning is what a future session needs and what a one-line "fixed the password field" would
lose.

## 2026-09-01 — `docs/implementation-backlog.md` 15133 → 15210 (BF-93, and BF-92 gets a better fix)

Chasing the owner's Sentry question turned up a second thing. **`error_events` does not prune.**
CLAUDE.md says it does, `lib/export/export-map.ts:167` says it does, and there is no `DELETE`
outside tests, no `pg_cron`, no trigger — with the data agreeing: the owner's oldest row is 32 days
old against a claimed 30. The table is now **52 MB on 728 kB of index**, second-largest in the
database, so it is payload rather than bloat. Q-539 already halved the message cap going forward;
the historical rows were never rewritten and still measure `avg 1904` against `max 2000`.

BF-93 carries the measurements and, more usefully, the two things not to do: do not delete rows to
improve a number (they are the only record of faults nobody saw), and do not confuse this with
BF-55, which is the inverse problem — indexes outweighing heap.

BF-92 grew because the recommendation **changed**. `withSentryConfig` turns out not to be wired at
all, and its `tunnelRoute` sends client events **same-origin**, which `connect-src 'self'` already
allows — so one change fixes the client blackout, source maps and release tagging together, and
cannot be re-broken by a future CSP edit. The CSP-host fix is now the fallback. The entry also
gained a natural experiment rather than an inference: 4 `source: client` rows reached `error_events`
from the same WebView, in the same week, that Sentry recorded nothing from. Same app, same errors,
different origin.

CLAUDE.md is corrected in place at no net line cost — the false half of the sentence is replaced by
the measurement and the reason the rule still stands.

## 2026-09-01 — `docs/implementation-backlog.md` (BF-88 loses a hazard that LB-43 removed)

LB-43 shipped while this PR was open (#729): the energy constants moved to the dependency-free leaf
and `movement-breakdown.ts` now re-exports rather than mirroring. BF-88's "the mirror test cannot
catch this" bullet and its sequencing bullet both described a two-copy world that no longer exists,
so they are **replaced, not annotated** — a warning about a file state that is gone is a warning that
gets obeyed anyway.

What survives is the part that got sharper: the value can stay at 3,000 while its *meaning* changes
from a threshold to a base credit, and no test that pins a number can notice. With one constant left
instead of two, the recommended rename is now a single edit the compiler propagates — which is the
argument for renaming rather than editing in place, and it is stronger after LB-43 than before it.

`Needs: LB-43` is dropped rather than left dangling; the protocol treats an absent target as shipped,
but saying so beats making the next reader infer it.

## 2026-09-01 — `projectOverview.md` → 8690, `docs/implementation-backlog.md` → 15167 (LB-41, LB-29)

Two shipped fixes recorded; **the backlog shrank**, since both entries were removed and nothing new
was filed. The status block is 11 lines for two entries because the interesting half of LB-29 is not
the bug but the promise the owner picked between: *the change follows to other devices* versus
*a local setting is never clobbered*. Those differ in what the app does, not in how it is written,
and a one-line "fixed preference sync" would lose the distinction the next session needs.


## 2026-09-01 — `docs/implementation-backlog.md` 15167 → 15260 (BF-94 swipe-to-rest, BF-95 the marker nobody reads)

A feature request that traced into a second, unrelated bug. BF-94 is the owner's *"swipe the full
button to turn it to rest"*; BF-95 is what tracing its gesture risk turned up.

BF-94's length is two things the request does not contain. **The card has two branches and the owner
screenshotted the rarer one** — on an ordinary day there is a single Start button and **no rest
affordance at all**, so the swipe is a bigger win where he was not looking. And on the deload branch
the swipe would make resting *harder*: Rest is one tap there today, and a gesture plus a tap buries
one of two answers on the one day the app is actively asking the question. The recommendation splits
the branches rather than applying the ask uniformly.

It also carries `Needs: BF-84` with the reason attached, because this session watched that exact
mistake: BF-84 replaces the `localStorage` rest flag with a stored fact, so building the *invocation*
first repeats the BF-87/BF-88 shape of shipping a surface against a mechanism about to change.

BF-95 is short and is a real defect: `swipe-actions.tsx` sets `data-swipe-actions` with a comment
saying it marks rows that own horizontal gestures, and `tab-swipe-navigator.tsx` excludes
`data-swipe-carousel`, `.overflow-x-auto` and `data-hscroll` — **not that one**. The marker is
written and never read. Latent only because a tab swipe must start within 24 px of an edge; the fix
is one string in a selector.

## 2026-09-01 — `docs/implementation-backlog.md` 15208 → 15253 (BF-96, a wrap mistaken for a layout)

The owner asked to *"go back to the old way when it was side by side."* It never stopped being side
by side — `weather-chip.tsx` renders `21° · UV 5` inline and the pill is **wrapping** at the space
inside `UV 5`.

Most of the entry is the measurement that makes the report make sense. The chip's sibling date is
`whitespace-nowrap shrink-0`; the chip has neither, so it absorbs every pixel of shortfall in the
row. And `EEEE d MMMM` runs **12 to 20 characters** across the year — today's *"Tuesday 1
September"* is 19. **The old way is the same code on a shorter date.** Without that, the obvious fix
is to shrink the chip, which would hide the wrap on most days and let it return each September.

The entry also answers the owner's *"make it smaller if needed"* with the reason it is the wrong
lever, and names the fallback that is right if the longest dates still overflow — shorten the date,
not the chip, because a phone already shows the date elsewhere and shows neither the temperature nor
the UV.

## 2026-09-01 — `docs/implementation-backlog.md` 15253 → 15336 (BF-97 scans never group, BF-98 macros drawn twice)

Two reports in one message, and the first turns out to be an entry's own motivating case still open.
`diary-groups.ts` opens by quoting the report behind BF-39 — *"one AI-logged breakfast as eight
diary rows"* — and grouping requires a resolvable **saved meal**, which a scan cannot have:
`mealGroupId` is minted in one place, always beside `savedMealId`, and the scan route references
neither field. BF-39 shipped the saved-meal half; today's screenshot is the same eight-row shape it
was filed for.

BF-97's length is the decision it refuses to take: **where a scanned group's name comes from**. The
grouping rule deliberately will not head a group it cannot name, so three options are laid out with
the recommendation (carry the scan's dish description, keep My Meals clean) and the trap named — do
not mint a placeholder saved meal to satisfy a display rule.

BF-98 is short because the fix is one variable. `logs.length > 1` gates the section footer on the
**flat** log count, so a 3-ingredient group passes it and draws macros that the group header already
drew. The file computes `entries` twelve lines earlier and its own comment states the rule — *"a
single row already states its own macros, so a footer would repeat it"* — applied to the collapsed
branch and never to this one. The entry works the condition through all four cases so the fix can be
checked rather than trusted.

## 2026-09-01 — `docs/agents/state/bugfix.md` 251 → 269 (two traps that each produced a false finding tonight)

Both are this role's own errors from this session, and one of them reached the file every agent reads
before anything else, so they go in the traps list rather than a journal entry.

**`grep … | head -N` cannot establish an absence.** It produced *"there is no Sentry"* (five
substring matches inside `MuscleSetsEntry`; `package.json` was below the cut) and then, an hour later
and unlearned, *"`error_events` never prunes"* (`head -5` showed two unrelated `prune` functions
while `adapter.ts:5093` holds the `DELETE`). The second was written into CLAUDE.md and Lane A had to
retract it in #737. The rule is stated as a hard never, with both instances named, because the first
one clearly was not enough.

**A write-triggered retention window is measured from the last write, not from `now()`.** The same
finding's second error, independent of the grep: 32 days against today looked like a broken 30-day
prune; against the last write it is exactly 30. What looked like the failure was the mechanism
working.

## 2026-09-01 — BF-92 corrected, and a third trap for the same mistake

The owner confirmed `NEXT_PUBLIC_SENTRY_DSN` is set, which contradicted this entry. Re-measuring
proved the entry wrong, not the owner: the original check `curl`ed **`/login`**, a **52-byte redirect
stub**, and a redirect answers "not found" to every grep. Against the real page and its 33 JS chunks
the DSN is inlined in three of them.

So BF-92 goes from two stacked failures to **one** — the CSP, which is re-verified and still has no
Sentry host, no wildcard and no bare `https:`. The retraction is kept visibly in the entry rather
than quietly deleted, because the false half had become an instruction to set a variable that was
already set.

The correction also buys the entry a sharper test than it had: with the DSN live and only the CSP in
the way, Sentry should hold **server events and zero browser events**. That asymmetry is one look at
the dashboard and it distinguishes three hypotheses at once.

The baton gains the third trap of the night in one family — Sentry, the prune, and now this. All
three were negatives asserted from evidence that could not have shown a positive: a truncated grep
twice, and a redirect stub once.

## 2026-09-01 — BF-92 answered from the dashboard, and LA-20 confirmed fixed

The owner opened Sentry: **one issue**, the Q-404 setup probe, 13 days old, server-side (US region,
no url, no browser). That is not one of the three outcomes this entry predicted, and it is better —
it settles all three at once.

Client events are blocked: **9 client-source `error_events` rows against 0 Sentry browser events**
over the same 13 days, same app, same device. Same-origin lands, cross-origin does not. Sentry
holding nothing *else* turns out to be correct rather than a second fault — it only sees uncaught
escapes, and the window's 34 server rows are all caught-and-reported (31 daytime-stress guard, 3
aborted disconnects).

The entry also gains the caveat the answer exposed: **0 `captureException` call sites** means Sentry's
whole view is uncaught escapes — 1 event against `error_events`' 43. A quiet Sentry is not a quiet
app, and fixing the CSP does not change that.

`projectOverview.md` grows by the LA-20 confirmation, found in the same queries: all **31**
`daytime-stress` occurrences fall on **2026-08-23**, the day of the fix, with **zero in the nine days
since**. That entry's `Keep: production not verified` asked for exactly this check and it had never
been run.
## 2026-09-01 — backlog → 15376, `projectOverview.md` → 8774, `docs/agents/state/tuning.md` → 359 (TN-20/TN-21, and a retraction)

**TN-20 is a data-integrity finding, and the length is the evidence that it is one.** A completed day
was observed in **both states within 24 hours** — 2026-08-31 read 113 drained / 3,643 samples, the
owner screenshotted it, and an hour later it stored 0 / 0 / end = anchor while 3,815 raw samples sat
untouched in `oura_heartrate`. Nothing logs the prior value, so the before/after table **is** the
proof; without it the entry is an unfalsifiable claim that a number used to be different. The derived
row's 55 → 25 / 56 → 15 against a normal 7.83 h summary is the second half, and the three-of-eleven
signature is what makes it a defect rather than an anecdote.

**It also carries a retraction of this agent's own published evidence.** TN-19 cited 2026-08-26 as
*"zero HR samples → zero drain"*; that day has **1,954 raw samples**, so the zero was TN-20. Q-521's
conclusion survives on its own correlations; the illustration does not. A retraction that does not
show why the original was wrong invites the next reader to reinstate it.

**TN-21** is shorter and mostly one table: the persisted stress series covers all 24 hours and is
**55% night**, with the two halves carrying opposite signs. Its Q-507 candidate is flagged **n = 9,
a lead not a result**, and specifically noted as the *reverse* of the density hypothesis refuted six
days earlier — the two use different quantities, and conflating them is exactly how that refutation
gets mis-cited.

## 2026-09-01 — `projectOverview.md` → 8810, `docs/implementation-backlog.md` → 15176 (BF-86)

One shipped fix, and the backlog entry shrank rather than grew — BF-86's queue text became a `Keep:`
plus the new `Verify: device`, since what remains is a look on the phone rather than work. The
status block is 13 lines because two of them are the part a future session needs and neither is the
bug: the **"close / full reset" the owner asked for is deliberately not built**, and the e2e test's
first version **passed with the fix reverted**. A shorter block would lose both and invite the reset
being built next time it is mentioned.

## 2026-09-01 — `projectOverview.md` → 8822, `docs/implementation-backlog.md` → 15196 (BF-98, BF-97)

One shipped fix and one lane annotation. The status block is 12 lines and eleven of them are the
part that matters: **the reported duplication could not be reproduced**, the e2e written for it
passed with the fix reverted, and it was deleted rather than kept. A one-line "fixed the double
macros" would read as verified work and is exactly what a future session must not believe. The
backlog grew by BF-98's `Verify:` and open-question note plus BF-97's measured lane.

## 2026-09-01 — `projectOverview.md` → 8834, `docs/implementation-backlog.md` → 15063 (BF-1, engine half)

The backlog **shrank by 133 lines**: BF-1's entry had accumulated the whole planning argument —
which analytes are in the report, why extraction rather than typing, the de-identification decision
and its reasoning — and all of that is now either shipped or in the plan document. What replaces it
is the three halves still owed, which is what a queue entry is for.

`projectOverview.md` grew 12 lines for a status block, and the lines are the four shapes the schema
had to survive rather than a summary of them. A shorter block would read as "blood panels are
stored" and lose the part a future session needs: that the verdict is **derived from the bounds and
never read off the provider's flag**, which is the one rule a well-meaning consumer would otherwise
break by trusting the words the report prints.

## 2026-09-01 — `projectOverview.md` → 8846, `docs/implementation-backlog.md` → 15016 (BF-96, BF-95)

Two shipped fixes. Both entries **stayed** in the queue as `Keep:` plus `Verify: device` rather
than being deleted, which is the new field's whole point — shipped-but-unseen is debt that should be
countable, not finished work that vanishes. The status block leads with the fact that the pill never
moved, because "go back to the old way" invites reverting a layout that was never changed, and with
the measured 12–22 character range that corrects the entry's own figure.


## 2026-09-01 — `projectOverview.md` → 8860, `docs/implementation-backlog.md` → 14993 (BF-97, engine half)

The backlog **shrank by 23 lines**: BF-97's entry carried the three-option decision and the argument
for each, which is now made — the engine built option 1 — so what is left is the rendering rule and
the two reasons a future session must not undo it.

(Both numbers are re-derived after merging BF-96/BF-95's own baseline change — a size baseline is a
measurement of the merged file, never a hunk to splice.)

`projectOverview.md` grew 14 lines, and the lines that could not be cut are the two negatives: a
group is minted **only** past one entry and **only** alongside a name. Both are what stop the fix
from rebuilding the bug one layer down, and a status block that said "scans group now" would be
wrong on top of being shorter — nothing renders differently until Lane B's half lands.
## 2026-09-01 — `projectOverview.md` → 8878 (BF-82)

+18 lines for one status block. It is long for one because a short version of it — "the More page is
grouped now" — is the version that gets a future session to redo the argument. What the lines buy:
the count is **nine single-row groups, not the seven the entry claimed**, because two of them were
outside `profile-tab.tsx` and one was a hand-written copy of the primitive rather than a use of it;
`label` became optional so a lone row can still be a card; and the *"sliders"* half is
recorded as **answered** with the owner's own words, because the alternative is a future session
reading the original request and changing a control nobody asked to change.

The backlog **shrank by 19 lines net** across the same PR — BF-82's entry lost the whole planning
argument it had accumulated (it is in the plan document, which is where it belongs) and kept only its
residue, and LB-44 was added.

(8878 rather than the 8864 this branch measured before merging: BF-97's engine half landed 14 lines
of its own in between. The number is a measurement of the merged file, never the sum of two hunks.)

## 2026-09-01 — `docs/agents/state/implementation-lane-b.md` → 168 (BF-82)

+12 net after trimming 7. The run was long — fourteen merges — and what the added lines carry is one
lesson repeated in four different disguises: **a guard that cannot fail is not a guard.** All four
passed on the first write and all four were caught only by mutating the fix away; none was visible by
reading. Compressed to a paragraph rather than four bullets, but not cut, because the *shapes* are
what a successor pattern-matches on and a one-line version ("mutate your guards") is the version that
gets nodded at. `BF-79`'s "do not re-litigate" bullet became a "has now been built on" bullet in the
same pass — BF-82 shipped, so the guard-rail has done its job and only the placement needs carrying.

## 2026-09-01 — compaction sweep: 250 entries → 227, starting `history-2026-09-01.md`

`docs/overview/entries/` crossed the **250-file total ceiling**, which fails the branch that crosses
it — here a Lane A feature PR whose only offence was adding its own journal entry. The 23 entries no
durable doc links to were folded oldest-first and `git rm`'d, per the chore in
[`entries/README.md`](overview/entries/README.md).

**A new history file rather than an append.** `history-2026-08-30.md` was 184 KB and the fold is
105 KB, which would have put it at **289 KB** — past the ~250 KB rule the README already carries. So
the batch opens `history-2026-09-01.md` instead.

**No new sweep hazard to record, which is itself worth recording.** The README's four link rules
(re-express every relative link from `docs/overview/`, not just `](../../`; point a folded sibling at
`#`; prefix a still-loose target with `entries/`; and fix the inverse — a loose entry linking to one
you folded) were applied mechanically and `check-doc-links` passed on the first run, against 935
files. The only rewrite outside the folded set was one loose entry pointing at a folded one, which is
rule 4 — the case the README calls easy to miss because it lives in a file the sweep does not
otherwise touch.

## 2026-09-01 — `projectOverview.md` → 8895, `docs/implementation-backlog.md` → 14914 (BF-59, screen half)

The backlog **shrank by 60 lines**: BF-59 carried the whole measurement — three tables of
stored-vs-landmark numbers and the argument for which fix mattered most — and that measurement is now
in the journal entry, where a session reads it once rather than every time it scans the queue.

`projectOverview.md` grew 17, and the line that cannot be cut is the one nobody would think to write:
**the engine and the screen now disagree**, where before this change they were wrong together. A
status block that stopped at "the target is phase-aware now" would read as finished work and hide the
inconsistency it introduced — which is precisely what a future session would need to know before
touching either side.

## 2026-09-01 — `docs/agents/state/implementation-lane-a.md` 208 → 189 (Lane A baton rewrite)

The baton is **rewritten in full** at each handover, never appended, so its length tracks what the
next session actually needs rather than accumulating. This pass dropped ~19 lines by retiring items
that are now closed — the database-reclaim section (Q-315, closed), three answered owner questions,
and a paragraph of traps from entries that have since shipped — while adding the four traps this
session hit.

Ratcheted down rather than left at 208: a baseline above the file's real length is headroom for
silent growth, which is the thing these numbers exist to stop.

## 2026-09-01 — `docs/implementation-backlog.md` → 14892 (LB-44 shipped)

A 22-line entry removed and nothing added: LB-44 is a flake fix with no residue, so it leaves the
queue whole rather than becoming a `Keep:`. Ratcheted down rather than left at the old number,
because a baseline above the file's real length is headroom for silent growth.

## 2026-09-01 — `projectOverview.md` → 8911 (LA-45)

+16 for one status block, and the lines that could not be cut are the two invariants. "Health shows
the corrected body fat now" is the short version and it is the one that gets the next session to
reverse one of them: `bodyFat` must stay what the log sheet seeds from — it POSTs at `manual`, which
outranks `scale_ble`, so a corrected value round-tripped through the edit sheet overwrites the
measurement permanently and collapses the next calibration toward zero — and "corrected" is never
inferred from the two values differing, because an offset can round to zero. Both read as pedantic
until you have written the wrong one, and neither is visible from the screen afterwards.

The line about the hand-seeded DEXA pair is there for the same reason: the local seed has no scan and
no `source_map`, so the whole feature is unreachable in the sandbox and a session that renders the
screen and sees a plain number has verified nothing.

(8911, not the 8894 this branch measured before merging: BF-59's screen half landed 17 lines in
between. A size baseline is a measurement of the merged file, never the sum of two hunks — resolving
that conflict by picking a side would have been wrong whichever side won.)
## 2026-09-01 — backlog → 14940, `projectOverview.md` → 8927, `docs/agents/state/tuning.md` → 375 (Q-507 explained)

**A two-week-old finding was reversed, and a reversal has to carry its evidence or it reads as a
whim.** Q-507 has said since 2026-08-18 that daytime stress correlates the wrong way with readiness
and cannot be built on. Recomputed from the model's own persisted buckets it correlates **−0.438**
(−0.699 waking-only) — the correct direction — while the stored scalar reads +0.338. The nine-row
stored-vs-buckets table is the proof, and the fact that **only the newest day agrees** is what ties it
to TN-20.

**The entry also retires two mechanisms, one of which this agent filed hours earlier**, and says so
plainly: both explained an artefact of the stored value rather than a property of the model. Without
that, the next reader finds three candidate explanations in the queue and no indication which
survived. The baton gains the general rule — **check the stored number is the number the model
produced before explaining why a metric behaves strangely** — which is the third time this session a
stored value turned out to be lying.

Caveats are carried at the same weight as the finding: **n = 8–9**, the waking window is this
review's choice rather than the app's, and re-testing at n ≥ 30 is a precondition for building
anything on the metric.

## 2026-09-01 — `projectOverview.md` → 8942 (Q-531)

+15, and the lines that cannot be cut are the correction rather than the change. "The device
consoles are grouped better now" is the short version and it loses the only thing a future session
needs: **the entry's premise was false, and checking it inverted the fix.** The consoles were already
routed under `/admin` and already gated; Q-234 had moved the links. Written short, the next reader
sees a tidy-up. Written this way, they see that an owner report can be literally true about the
navigation and literally false about the routing, and that the difference decides whether you are
fixing access control or reachability.

The backlog **shrank by 24 lines** — Q-531 carried the whole owner-gate argument and a superseded
block preserved from before the decision, both of which are now either shipped or in the journal.

(8942, not the 8926 measured before merging: TN-22 landed 16 lines in between. A size baseline is a
measurement of the merged file, never the sum of two hunks.)

## 2026-09-01 — `projectOverview.md` → 8953 (LA-42)

+11 for a deletion, which looks disproportionate until you ask what a shorter version would say.
"Removed an unused prop" invites the next reader to wonder whether it was safe. The lines that earn
their place are the two negatives — **no guard** (the invariant lives in Lane A's file and a test
pinning it would block the revival it is meant to protect) and **no version bump** (nothing visible
changed, and a changelog line for an invisible change is a claim the owner cannot check). Both are
decisions someone would otherwise re-take, and neither is recoverable from the diff.

The backlog **shrank by 20 lines** — LA-42's entry, removed whole, since nothing is owed.

## 2026-09-01 — `docs/implementation-backlog.md` → 14899 (BF-69 planned)

Eight lines replacing three. The growth is one measurement and its consequence, and neither
compresses: production holds **two supplements, one log ever, no amounts, and no retatrutide row**,
so BF-69's own framing — *"the storage is done, there is no reader"* — is right about the reader and
understates the rest. The line that has to survive is the one that reorders the work: the trends
overlay is gated on **data**, not effort, and building it first would render a chart of one point
where a broken query and an empty one look identical.

## 2026-09-01 — `docs/implementation-backlog.md` → 14924 (BF-64 re-classified to Lane B)

Seventeen lines, and they are three findings rather than restatement. BF-64 was assigned Lane A on
the assumption its fix lives in the server pipeline; following its own recommendation, the fix is
entirely client-side and Lane B's. The two lines that would otherwise cost the implementer a day
each: `applyDeloadReverts` **already** clears `deloaded` so the PR path treats a reverted exercise
as full — the hazard the entry flags is handled by the mechanism it recommends — and
`preDeloadStyle`'s all-false `useFor1rm` **looks like a bug and is not**, because `estimateOneRm`
reads an all-false style as "use them all".

A finding that something is *not* broken earns its lines here exactly when the thing looks broken on
sight, which this does.

## 2026-09-01 — `docs/implementation-backlog.md` 14924 → 15034 (+110)

`docs/owner-decisions-round2`. A full sweep of the eleven `Gate: owner` entries, put to the owner in
two rounds. **Seven decisions came back and the queue now holds zero unanswered owner questions** —
the remaining seven gates are a decision already made (`Q-1b`, `Q-149`), an action deferred to a
later batch (`Q-11`, `Q-71`), an action accepted (`Q-4`), an entry the owner explicitly held
(`Q-551`), or one whose own text forbids asking (`TN-16`).

The growth is decisions and their reasoning, which is the expensive half to reconstruct:

- **`Q-149` carries a new production measurement that falsifies two of its own premises** — the
  chest strap is the dominant HR source (156 rows against the ring's 39, and 88% coverage against
  54%), and the "~7 usable verdicts" figure was stale: there are **84**. With mean peak at 99 bpm,
  the textbook 15 bpm bar fails **76%** of this owner's sets. That table is why the answer is "fit
  it to the user" rather than "pick a smaller number", and it is what Tuning starts from.
- **`Q-294` records four decided failure behaviours**, two signed by the owner and two defaulted,
  labelled so a reader can tell them apart. The decision *was* the work; it becomes a `Reference:`
  for Q-249's scenarios.
- **`LA-50` and `Q-253` are declined**, and each keeps the measurement that argued it — the
  Chromium-version gap and the Firebase/BrowserStack comparison — as `Reference:` so a future
  session reads rather than re-derives.
- **`Q-48` lost its gate without an owner answer**, because it never needed one: F3 and F7 are now
  answered, F8 was fixed in its own PR, and what remains is planning work that had been invisible
  behind a decision field for weeks.
## 2026-09-01 — `docs/implementation-backlog.md` → 14976 (LA-52 filed, LA-48 re-scoped)

One new entry and a scope correction, both from reading code rather than from a report. The lines
that cannot be cut are the three consequences of the pacer's speed rung being fed a whole-walk
cumulative average: the band cannot respond within a segment, `STOPPED_KMH` can never fire once the
average clears 1.5 km/h, and warmup/fast/slow all band against the same drifting number. Without
them the entry reads as a preference about smoothing rather than as two of LB-36's device checks
being unable to pass.

LA-48's correction is shorter but saves more: there is **no migration and no local schema version**
in it — `segments` is JSONB one side and TEXT the other — and the trap is the **wire schema**, where
Zod strips an unknown key silently on both write paths.

## 2026-09-01 — baton 189 → 193, `docs/implementation-backlog.md` → 15028 (queue hygiene + BF-4 closed)

Five lines onto the baton, and they are the finding a successor needs before anything else: the
**startable** Lane A queue is thinner than READY's count, entry by entry, with the reason each of the
top seven is blocked. A successor that reads "61 READY" and starts at the top spends its first read
discovering that — which is what happened here.

The backlog grows by LA-53 (proposing a check for the one mechanical case) and by Q-535's lane
correction. Q-535 headed **Lane A's** list for two weeks after its Lane A half shipped, because
`next-item.js` reads the `Lane:` field and nothing re-reads it when the remaining work moves lanes.


BF-4 rides here too: it was **closed by measurement**, and the closing note is longer than a strike
because the numbers contradict the entry's own lever — latency fell 36% across the 1024 px bound
while input tokens **rose** 14%, so the r = +0.958 it rested on did not survive the intervention. A
close that just said "stopped" would leave the next person to re-derive that. The baton shrinks by
two lines in the same pass: it listed a photo scan as owner-gated when that gate cleared on
2026-08-30, which is the stale-premise failure this baton spends a section warning about.

## 2026-09-01 — `projectOverview.md` → 8967 (Q-354)

+15 for a docs correction, which is only worth it because of what the short version omits. "Fixed a
stale note in the e2e README" reads as tidying. What happened is that the note was **backwards**, in
the file written to stop people falling into that exact trap, so it did not fail to help — it
actively sent readers to the workaround the relevant spec had deliberately abandoned. That
distinction is the reusable lesson, and it does not survive compression.

The second half is the queue mechanic: an entry whose own text says *do not pursue* sat at the head
of READY, so every session in turn was offered a build it argues against and skipped it. `Reference:`
exists for that and nobody had applied it.

`docs/implementation-backlog.md` → **15040** after merging (+12 from this PR; the rest is BF-4/LA-53 landing alongside): Q-354 keeps its whole body, because
it is now a reference and the body IS the artefact — the measured input-method table is the thing
other entries and spec authors read. What was added is the `Reference:` line and the correction note
recording that the README pointed the wrong way, which is the part a future reader would otherwise
re-derive by trusting the old text.

## 2026-09-01 — `docs/agents/state/implementation-lane-b.md` → 174 (Q-354 PR)

+6 for one gotcha, recorded the moment it happened rather than at wrap-up, because a session can end
between the two. Running `pnpm check:rules > f; echo $?; git commit && git push` pushed a branch the
gate had just failed — the push depends on the *commit's* exit status, never the gate's. The baton
already carried "never check a gate through a pipe"; this is the same mistake in different clothes,
so it sits directly under it where the pattern is visible rather than as a separate entry that reads
as unrelated.

## 2026-09-01 — `docs/implementation-backlog.md` 14940 → 14973 (BF-99 a label, BF-100 a missing mechanism)

**BF-99's length is the reconciliation, and it is the point.** The owner asked why his base sits below
his measured RMR, which reads like a maths bug. It is not: every number on the screen checks out. The
entry reconstructs the chain against live production values and lands on the screenshot at **three
independent points** — 1,565 maintenance, 1,264 "base", 163 over target. What it finds is a **label**:
1,264 is the base *after* the recomp deficit, so a goal choice is presented as a metabolic fact, and
the real resting base is ~1,464. Without the table an implementer would hunt a calculation error that
does not exist, and might remove the `Math.max(bmr, …)` floor that is doing its job.

It also answers the half he did not ask: the RMR is **rescaled**, not used raw — 1,325 was measured at
51.5 kg of lean mass against ~50.6 kg today — which is `personalRmr` working as BF-42 built it, and
is explained nowhere on screen.

**BF-100 is short because the cause is single.** The app scrolls an inner container
(`pull-to-sync.tsx:190`, 62 files carrying `overflow-y-auto`), and Next's restoration only handles
the document scroller. No code has ever saved a position — so *"many pages if not all pages"* is
exactly right, and one fix in the shell covers every screen. The two warnings are the ones that make
a naive attempt fail: restoring before the cache-seeded content has height gets clamped to 0 and
looks identical to the bug, and restoring on forward navigation is wrong.

## 2026-09-01 — `projectOverview.md` → 8984 (BF-64)

+17 for an owner-reported bug, and the lines that earn it are the ones a short version would cut
first. "The Full toggle works now" hides the mechanism — the override was applied inside an `else if`
that only ran when the exercise was **not already deloaded**, so the pipeline could add a deload and
never remove one. That asymmetry is the reusable part: a control can be fully wired and still be
one-way, and the screen will not show you which.

The other two kept lines are negatives. The override keys on an **explicit choice**, because keyed on
`!deload` it would paint full weights for a frame and snap back — invisible in review, obvious on a
phone. And the verification line says the fixture was **hand-built**, because the local seed has no
`ai_dynamic` program and zero prescriptions: a session that renders this screen and sees a toggle has
verified nothing, and would not know it.

## 2026-09-01 — `projectOverview.md` → 8999 (BF-99)

+15, and the sentence that earns most of it is *"every number on the screen reconciled."* A short
version — "renamed a label" — loses the only thing that makes this instructive: the arithmetic was
right and the copy sent the owner hunting a calculation bug that did not exist. That is a distinct
failure mode from a wrong number, and it is the one a future session will not think to look for.

Two negatives are kept for the same reason as always: the split is in the component and **not** in
`budgetProvenance` (shared, and one combined number is correct for a caller that wants one), and
neither the `Math.max` floor nor the goal maths was touched — both look like the bug and are not.

## 2026-09-01 — `docs/implementation-backlog.md` 15084 → 15150 (BF-101 the numbers already exist, BF-102 a false prompt)

Two Profile-screen asks, and tracing turned the first into mostly plumbing and the second into a bug.

**BF-101.** The owner guessed the recommended values might not need AI. They do not:
`calculateBaseline` already returns calories, protein, carbs, fat, water and steps deterministically,
off the **measured** RMR via `personalRmr`, and the AI route computes that baseline first and then
adjusts it. The entry's length is the evidence that the button is worth having — Activity Level is
**Moderate** (steps → 10,000) against a stored Steps Goal of **7,000**, the sedentary value, while
water tracks moderate to 16 ml. One field follows the recommendation, one does not, and the screen
says nothing. Plus two guards: sleep has no baseline and must not get an invented one, and an
incomplete profile must hide the button rather than compute from absent inputs.

**BF-102** starts from the owner being right — the calorie model is measured, not multiplied by the
picker (Q-401) — and then has to say the harder thing: activity level is **not** dead, it still
drives the step goal and the water bump, so this is a feature rather than a deletion. The finding
that earns the entry is a live defect beside it: the recommend route's prompt reads
*`activity level "moderate"): … TDEE X`*, implying the TDEE was computed for that level when it is
`bmr × 1.2` regardless. **The model is told something false about its own input**, and that is worth
fixing whether or not a Calibrated option ever ships.

## 2026-09-01 — `docs/implementation-backlog.md` (BF-103 a label removed twice, BF-104 a multiplier with no setter)

**BF-103 is mostly history the next reader must not repeat.** The owner asked for the Meals tab to
become "My foods" — which is precisely the label **BF-37** and **BF-60** removed, the second because
*"`My Foods` against `My Meals` is the pair the owner could not tell apart."* Renaming the tab while
the page button still says `My Meals` re-creates that pair in the one place the earlier fix left
alone. But his reason is new and measured: **5 of his 10 saved meals hold exactly one item**, so the
label is untrue rather than merely confusable. The entry separates those two arguments and
recommends `Saved` — which names a source alongside Recent and Search, is true of both shapes, and
collides with nothing.

**BF-104** is short because the storage is already right: every `food_log` carries its own
`quantity_multiplier` and `logMealFromSaved` copies each item's factor from the definition, so the
only missing piece is a meal-level scale to multiply through. The length is spent keeping it away
from `meal-batch-size` — "makes N portions" is definition-time and this is log-time, and the two
multiply rather than substitute — and on stating the trade in scaling at write time: the rows stay
self-describing snapshots, at the cost of "I ate 1.5×" not surviving as a fact. BF-3 made the
opposite call for supplement doses, for a reason that does not apply here.
## 2026-09-01 — `docs/implementation-backlog.md` → 15174 (merge resolution)

`docs/owner-decisions-round2`, merging `main`. Re-measured after the merge, not carried across it.
Both sides of this file's own conflict kept — append-only, so a conflict here is two additions.
Entry-ID set diffed against the new `origin/main`: **identical, nothing added or lost.**

## 2026-09-01 — `projectOverview.md` → 9015 (BF-100)

+16, and unusually the count of traps is the payload rather than a detail. Ten defects — six in the
hook, four in the spec — every one of which produced code that runs, does what it says, and achieves
nothing. Two were StrictMode's double-invoked effect in *different* shapes (a consumed `popstate`
flag; a cleanup writing 0 over a pending target), which is the reason the second one cost as much as
the first: the lesson from one did not generalise to the other.

The line about the four spec failures all reporting `expected 840, received 0` is the one that saves
the most time later. That is what makes a fixture problem indistinguishable from a regression, and
the fix — a spec that asserts its own preconditions — is worth more than the feature it guards.

## 2026-09-01 — `docs/implementation-backlog.md` 15352 → 15376 (BF-103 rewritten on an owner decision)

+24 lines, all inside one existing entry — no new entry, no new heading. The owner rejected BF-103's
`Saved` recommendation in favour of `My Foods` on every surface, on the grounds that the historical
failure was two labels for one list rather than the wording of either. Rewriting the entry to record
that cost more lines than it saved because the sweep that came with it is the substance: `My Meals`
turned out to be **eight** user-visible strings across five files, not the two the entry named — a
toast with two arms, an empty state, three buttons, a badge and an `aria-label` — and a table naming
each is what stops the rename shipping half-done. The other addition is a warning the entry did not
carry: `My Foods` was already the name of a **merged** list in v1.382.0 and the merge was reverted in
v1.385.0, so an implementer reading the new label could reasonably re-merge the tabs and reintroduce
a defect the app has already paid for. Both are the kind of thing that is cheap here and expensive in
review.

## 2026-09-01 — `projectOverview.md` → 9031, `docs/implementation-backlog.md` → 15417 (LB-46 closed, LB-47 filed)

+16 for a finding with no code change, which is the unusual case where that is clearly worth it: it
records that a fix **already merged this session** may not do anything on the data it was built for.
Burying that in a backlog entry and leaving the status block silent would be the version that costs
something later.

The measurement is the durable part — 5 prescriptions, 1 session deload, 2 per-exercise, **0 both** —
because it is what distinguishes the two deload mechanisms, and conflating them is what produced both
the false finding and the doubtful fix.

## 2026-09-01 — `docs/agents/state/implementation-lane-b.md` → 179 (conflict-marker staging slip)

+5 for a gotcha found the same session it was needed. `git add -A; git status | grep '^UU'` always
reports no conflicts, because staging clears the UU state — so the check that was meant to confirm a
clean merge confirmed nothing, on a file `git merge` had genuinely left conflicted. `check:rules`
caught it at the `No unresolved conflict markers` step.

It sits next to the two existing gate gotchas because all three are the same mistake: reading a
signal that has already been destroyed by the command before it.

## 2026-09-01 — `projectOverview.md` → 9040, `docs/implementation-backlog.md` → 15415 (LA-53 shipped)

The backlog shrank: LA-53's entry carried the three worked examples and the design argument, and
those are now in the journal. What stays is the two cases no script will ever catch — BF-64 and
LA-47 — and the question of whether the note should ever fail rather than print.

`projectOverview.md` grew 8, and the line that earns them is the one about the rule reporting **its
own documentation** twice before the exclusions existed. Without it the note reads as ordinary
caution; with it, the reason it prints rather than fails is a measurement.

## 2026-09-01 — `projectOverview.md` → 9053 (BF-103)

+13 for a rename, which only earns it because two of the lines are about *not* undoing it. The
comments BF-37 and BF-60 left behind read as a standing prohibition on the name `My Foods`, and the
next session reverts this on their authority unless the record says why unifying satisfies them. The
other is the merge: `My Foods` was once a merged list, and the revert that split it was about the
merge, not the name — an implementer who conflates the two reintroduces a defect already paid for.

The line about the guard finding twelve e2e specs the entry's own file table missed is there as
evidence for a general point: a rename's blast radius includes its tests, and a file table written by
reading will not contain them.

## 2026-09-01 — `docs/implementation-backlog.md` 15376 → 15443 (BF-105, walk phase cues)

+67 lines for one entry, above the usual because most of it is evidence that the obvious diagnosis is
wrong. "The phase change isn't signalled" reads like a missing feature; the cue is in fact scheduled,
on a real HIGH-importance channel with a default sound, on an exact alarm with `allowWhileIdle`. Each
of those took a check — including the pinned plugin source for what an absent `sound` does, which is
keep Android's default rather than go silent — and an implementer who skips them builds a cue that
already exists. The entry also carries two things that would otherwise be found on-device at the cost
of an APK cycle: a NotificationChannel's sound and vibration are immutable once created, so
differentiating fast from slow needs new channel ids rather than edited settings; and that work is JS
in `capacitor-native-init.tsx`, so it ships through Railway despite looking native. The one genuinely
native piece — a custom sound file in `res/raw/` — is marked as such.
## 2026-09-03 — backlog → 15102, `projectOverview.md` → 9009, `docs/agents/state/tuning.md` → 388 (TN-23)

One entry, from one owner question about one night — and the length is the **arithmetic that turns an
opinion into a finding**. The ten stored contributors blend to **76.04**; the app shows **63**. Without
that reproduction the entry is "the sleep score feels low", which is unactionable and has been asked
three times.

**TN-23 itself is the new part**: `hrv` and `hr` correlate at **+0.869** across 38 nights, share 75%
of their variance, and carry **28 of 110** — a quarter of the score on one physiological axis, charged
twice. The entry spends its lines on the ⛔ **do not delete a contributor**: both curves are provably
correct for this night, and the combined signal is the score's best recovery evidence, so the naive
fix would remove the most informative input in the model.

The baton gains the general move — **reproduce a score from its stored contributors before theorising
about it** — plus the observation that twice now the owner's *"this is too low"* resolved to the
**display curve** (TN-5, signed off, unshipped) rather than to the model.

## 2026-09-03 — `docs/agents/state/tuning.md` → 395 (the sleep-baseline near-miss)

Seven lines, and they stop a false finding that was one edit from being filed. Asked whether a 100
sleep score is reachable, this agent compared stored `hrv` contributors against
`oura_daily_summary.hrv_baseline_mean_x8` and concluded the owner's best nights had been inflated by
an immature baseline. **The sleep score does not read that column.** `buildSleepAudit` calls
`sleepScoreBaselines(prior, tz)` — a trailing window over prior nights, excluding the night being
scored.

The rule *"read which baseline a consumer actually calls"* was already in this baton from three
earlier instances this week and was walked into anyway, which is the argument for stating it against
the **specific** consumer rather than in general. The entry also records the positive half: this is
the one baseline in the codebase built correctly, and TN-6 can copy it rather than invent one.

## 2026-09-01 — three docs raised for the fault beat and two walk reports (BF-106/107/108)

`docs/implementation-backlog.md` 15481 → 15610, `projectOverview.md` 9063 → 9115, `CLAUDE.md`
1198 → 1204.

The backlog gains three entries. **BF-106** is the third database-size reading `projectOverview.md`
asked for, and it costs its length by ruling things out rather than asserting: ingest is flat, the
7-day window holds, `n_dead_tup` is 0 with autovacuum having just run — so the above-trend growth is
neither data nor bloat but an un-pressed `VACUUM FULL` the packer's own docstring already calls "a
single press". The Q-315 precedent is written in beside it, because the identical argument about
`error_events` predicted a large reclaim and the button returned 0 B. **BF-107** and **BF-108** are two
owner reports from one walk; each names the trap that makes the obvious fix wrong — adding a calories
tile renders a dash, because the value is derived server-side after the screen paints; and fixing only
the Done destination leaves the stale title, which is reachable from the tab bar anyway.

`projectOverview.md` replaces the growth row with its resolution (the superseded reading is folded
into a `<details>` rather than deleted) and adds a production confirmation to the LA-37 row that
narrows the device check from "does the fix work" to "press the button".

`CLAUDE.md`'s +6 lines are a correction, not an addition: it stated `last_analyze`/`last_autovacuum`
are "NULL on every table", which was true on 2026-08-20 and is false now. The rule it justified — use
`count(*)` — survives and is more important than before, because coverage is now *partial*:
`oura_raw_samples` reads exactly right while `oura_raw_packed` still reads 55 against 1,051, and
nothing in the output says which side a table is on.
## 2026-09-01 — `projectOverview.md` → 9078 (BF-101)

+15 for a feature whose whole point is a claim about *numbers*, and the numbers are what has to be in
the index. The 7,000-against-Moderate drift is the evidence the control exists, and it is the one
line a future session would otherwise have to re-derive from the owner's screenshot to know whether
the feature is working.

The measured-RMR sentence is there for a narrower reason: it is the decision most likely to be
undone as an optimisation. Dropping that fetch looks free and silently reintroduces the "two numbers
for one thing" defect LA-45 and BF-99 each cost a session to close.

The backlog baseline is untouched — BF-101 left the queue as a shipped entry with a `Keep:` line for
its device check, and LB-48 replaced it in roughly the same number of lines.

**Recomputed from the merged file on rebase**, not spliced: `main` had moved to 9063 while this
branch sat behind a red base, so the number this branch first wrote (9068, from a 9053 base) was
stale by exactly the block someone else added. 9078 is the merged file's own count.


## 2026-09-01 — `projectOverview.md` → 9145 (LA-52)

+15 for a defect whose whole content is *which number the screen was showing*. The three
consequences — the band cannot respond, `STOPPED_KMH` can never fire, warm-up/fast/slow band against
one drifting figure — are what a future session needs to not re-derive from the pacer's source, and
they are the argument for the window existing at all.

The sentence about the on-screen km/h earns its line separately: the entry did not name that half,
the code comment beside it actively said the opposite, and it is the part a reader can check by
looking at the screen. The e2e line is there because a spec that asserts something now deliberately
false is the kind of thing a later session "fixes" back.

**This number was recomputed three times and the warning it was written under came true.** The branch first
wrote 9068 against a 9053 base; `main` then moved to 9063 behind a red CI (#775, #778, #766), making
that stale before anything merged; #776 (BF-101) then landed its own 15-line status block on top, and
#780 (BF-106) another after that.
9145 is the merged file's own count. All three intermediate numbers were arrived at by recomputing from
the file rather than splicing the conflict hunks, which is the only resolution that survives a base
moving twice.

## 2026-09-01 — `docs/implementation-backlog.md` → 15663 (LA-52 + two splits)

+56, and only about a third of it is LA-52's own shipped entry. The rest is two splits — **LB-49**
(the meal-log scale argument) and **LB-50** (the measured activity factor plus a prompt string that
tells the model something false) — carved out of BF-104 and BF-102 so their surface halves stop
reading as startable to a lane that cannot start them.

That is the trade this file exists to make visible: two entries that looked like work became four
that describe it accurately, and the queue tool now parks two of them behind their engine halves
instead of offering Lane B a build it cannot begin. LB-50's prompt bug is worth the lines on its own —
it ships without any feature attached.

## 2026-09-01 — `projectOverview.md` → 9159, `docs/implementation-backlog.md` → 15659 (Q-187)

+14 on the index for a feature whose failure mode is silent. The floor sentence is the line that
matters: a session reading only "the plan re-scales" would take the floor for a rounding guard and
delete it, and the whole reason it exists is that a plan telling you to eat 180 kcal for dinner is
ignored once and then always.

The correction about `fillableMeals` is there because the backlog entry itself asserted the wrong
set, confidently, and the next reader of that entry would inherit it. Naming the two sets as
complements is shorter than re-deriving which is which from `plan-day-fill.ts`.

The backlog grows by Q-187's shipped form plus **LB-51**, which records that the seed creates no meal
plan and no food logs — so the entire plan card, not just this feature, has no e2e reachable from the
harness. That is worth its own entry rather than a line inside a shipped one, because it blocks four
existing behaviours as well as this one.

## 2026-09-02 — `projectOverview.md` → 9195, `docs/implementation-backlog.md` → 15677 (BF-69 stage 1 shipped)

Both grew, and the backlog's growth is the kind this file exists to argue about: BF-69 stayed in the
queue rather than being removed, because only stage 1 of four shipped. Its `Keep:` block is longer
than a `Keep:` usually is because the entry's own `Lane:` line says "A for the read model and any
schema" — a reader who stops there would take stage 4 next, which is gated on data that does not
exist. The block names which stage is next and which lane owns it, which is the only thing that stops
that.

`projectOverview.md` grew for two reasons, and the Known-Issues row is the one that had to be
written: local v34 rebuilds a table rather than adding a column, and every prior local migration that
killed this app killed it by throwing on retry. A row that just said "not device-verified" would read
like the eight others above it and get the same weight; what makes this one different is *which*
statement is unverified.

## 2026-09-02 — `projectOverview.md` → 9205, `docs/implementation-backlog.md` → 15689 (LB-51 + queue hygiene)

The index grows by one block and it is a **question for the owner**, which is the one thing this file
is unambiguously for: whether the E2E job becomes a required check. It carries the measurement that
settles the half nobody had checked — E2E is *not* required today, proven by a PR merging with its
E2E job still in progress — so the owner is deciding rather than investigating.

The backlog **shrinks** on net despite three entries being rewritten: Q-297 lost most of its body to
things that had shipped under other numbers, Q-138 became a `Reference:` with its stale line numbers
flagged, and LB-51 went from a proposal to a shipped entry whose useful content is that its own
proposed shape was wrong — a spec here can reach Postgres directly and does not need to stub a route.

The +19 on top of that is **Q-111's two corrections**, and they are the most load-bearing lines in
this diff. The entry claims a shipped ring chip on the Home header that **is not in the tree**, and
claims nothing in JS reads the strap battery when a pairing screen reads and displays it by a second
route. An implementer taking the entry at its word would build the strap half against a false picture
of both ends. Git cannot arbitrate the first — history starts at the public snapshot, after the
claimed date — so the correction states what is observable and stops there.

## 2026-09-01 — `projectOverview.md` → 9067, `docs/implementation-backlog.md` → 15436 (LB-37 shipped)

The backlog shrank: LB-37's entry carried the whole measurement argument — the method, the error-code
breakdown, the case for a ratchet over a sweep — and that is now in the journal, where it is read
once rather than on every queue scan. What stays is where to start, ordered by consequence.

`projectOverview.md` grew 14, and the line that cannot be cut is the one about the gate itself:
**"tsc clean" carried no information about any spec**, which is a sentence written in dozens of PR
bodies in this repository, several of them from the same session that shipped this. A status block
that said "test files are typechecked now" would read as a small hygiene win and lose why it matters.

## 2026-09-01 — `projectOverview.md` → 9232, `docs/implementation-backlog.md` → 15645 (LB-31 shipped)

The backlog shrank: LB-31 carried two findings and a long options list, and what is left is the merge
queue plus the correction to its own mechanism. That correction is the part worth the lines — the
entry's account was half right, and the missing half (an unawaited snapshot write racing the next
test) is the whole reason an hour failed to reproduce it.

`projectOverview.md` grew 13. The line that cannot be cut is that **the file was passing on a race**,
not that a flaky test was fixed: the same shape — an assertion whose setup depends on a fire-and-
forget write from a previous test — is reachable anywhere else the pattern appears.

## 2026-09-02 — `projectOverview.md` → 9247, `docs/implementation-backlog.md` → 15640 (Q-111)

+15 on the index, and most of it is a **correction to a claim the index itself would otherwise keep
propagating**: Q-111 said its ring half was already on the Home header, and it was not. The next
session to read that entry would have skipped the ring chip entirely. The strap correction is the
same shape in the other direction — the entry said nothing read the strap battery when a pairing
screen reads and displays it, so the real defect was two numbers in two screens rather than a
missing read.

The two owner items are the rest: the scale needs Kotlin BLE work that no lane here can do, and the
manual refresh button question now carries its measurement — it does **not** bump `refreshTick`, so
it is strictly narrower than pull-to-sync rather than redundant with it. Both were sitting inside a
long entry where an owner would never find them.

The backlog is flat on net: Q-111's shipped form replaced a body of roughly the same length.

## 2026-09-02 — `docs/implementation-backlog.md` → 15560 (BF-4 and Q-156 removed; a ratchet DOWN)

The first entry in this file that lowers a baseline rather than raising one, which is the direction
it is supposed to move and rarely does. 85 lines came out: two entries that had concluded in their
own text and stayed in the queue anyway — BF-4 measured and closed, Q-156 traced to "no fix is
warranted, and none was made".

Neither finding was deleted with its entry. Q-156's conclusion moved to the sleep pillar's Gotchas —
that `sleep_sessions.sleep_score` is a dead column, and that a per-night score has to come from
`oura_daily` or `oura_daily_derived`, neither of which is complete. BF-4's closing measurement was
appended to its own investigation doc, where the `r = +0.958` it retracts is written down. Deleting
a finding to shorten a queue is how it gets re-discovered in three months.

## 2026-09-02 — `projectOverview.md` → 9260, `docs/implementation-backlog.md` → 15535 (LB-48 shipped)

The backlog shrinks again — LB-48 removed, and an entry (LA-54) written during the same session
withdrawn before it was ever pushed, because the premise it rested on was the one this work
falsified.

`projectOverview.md` grows by more than the fix deserves, and deliberately. The four-line change
does not need a status block; the measurement does. An entry reasoned its way to "stale until the
app is restarted" from a true premise about the tab shell, and the reasoning stopped one route
short — the form that triggers the write is not in the shell. That shape (correct premise, correct
inference, wrong scope) is the third premise failure of this session, and the block exists so the
next reader sees the method rather than the four lines.

## 2026-09-02 — `docs/implementation-backlog.md` → 15536 (LB-38)

Roughly flat: LB-38's rewrite replaced a body of similar length, and what changed is which
measurements it carries. The two falsified hypotheses stay — they are the entry's most valuable
lines, because each cost a session to eliminate — and the timing table that looked like decode
evidence is now labelled as transfer cost, which is what it always was.

`projectOverview.md` is untouched: nothing user-visible shipped, and a spec getting 2.5× faster is
not something the index needs to carry.

## 2026-09-01 — `docs/implementation-backlog.md` → 15603 (BF-109, barcode calorie mismatch)

One entry, and most of its length is the wrong answer being ruled out. "The calories weren't scaled to
the serving" is what the screenshot looks like and it is what anyone will try first; the source row
was fetched from Open Food Facts to show the app read `_serving` consistently for every field and the
mapper is correct. Recording the actual row matters twice over, because its `energy-kcal_100g` turns
out to be derived from the same bad figure — so the obvious remedy of preferring per-100g would fix
nothing here and break the products that are fine. The rest is the sibling-surface trail: the guard
exists, its docstring describes this exact Open Food Facts failure, it runs on the text-search list
and the scan routes, and the barcode path is the only route from that database into the diary with no
check on either end. The measured blast radius (0 of 11 saved barcode items mismatched) is what keeps
the entry a warning-banner change rather than a data-repair project.
## 2026-09-02 — `projectOverview.md` → 9280, `docs/implementation-backlog.md` → 15505 (LB-49 shipped)

The backlog shrinks by LB-49's entry. `projectOverview.md` grows by a block that is mostly a list
of what that entry got wrong, which is the part worth carrying: a name that does not exist, a lane
justified by a rule that does not apply, a sync chain its own decision made unnecessary, and two
missed write sites.

## 2026-09-02 — `docs/overview/entries/` total ceiling 250 → 320

`main` sat at exactly 250, the ceiling. The standing rule puts a journal entry in every PR, so the
next entry from any of the six agents took it to 251 and failed CI for all of them. This was found
by walking into it.

**The raise is not a workaround, and the numbers are the argument.** The check has two guards: a
limit of 60 on the UNLINKED count — the ones a compaction sweep can actually fold — and a ceiling on
the total. Unlinked read **3**. The sweep mechanism is working exactly as designed. The ceiling was
firing because entries are *well cited* by durable docs, which is the habit that file's own README
spends several paragraphs establishing, and penalising it is backwards.

The alternative was folding the foldable ones, and it does not apply here: all four were written in
the preceding two days, so a sweep would have deleted the newest entries in the directory rather than
the oldest. The real compaction — folding linked entries and repointing the durable docs at a batched
history — stays available and is what the ceiling's message asks for; it is a large chore with four
documented link-breaking failure modes, and it was not worth taking mid-feature to unblock a
four-line parameter change.

**Correction, same day, before this merged:** another agent swept two entries and `main` dropped to
**248**, so by the time this landed it was preventing a recurrence rather than clearing a live
stoppage. The raise is kept because the argument never rested on the count — it rests on the ceiling
measuring the wrong thing while the guard that measures the right thing reads 3 of 60 — and because
248 is two PRs from the same wall.

Reversal is one number. The signal to do the real work instead of raising this again is the floor
rising from something other than journal citations.

## 2026-09-02 — `docs/implementation-backlog.md` → 15597 (Q-48 F6, Q-48 lane, Q-51 gate)

Small, and two thirds of it is one struck line plus the citation that justifies striking it. Q-1b
asserted its downstream gates were released and, further down the same entry, that they were still
blocked — so the strike needs both quotes beside it or the next reader restores the line from the
half they happen to hit first.

The Q-51 gate note is the rest: it records **why** the measurement cannot be taken in the sandbox
(`pnpm dev` compiles on first mount; `next start` forces SSL on the pg pool), because "needs a
device" without the reason invites the next session to try anyway.

## 2026-09-02 — `projectOverview.md` → 9292, `docs/implementation-backlog.md` → 15610 (LB-50's prompt half shipped)

The backlog grows rather than shrinks: LB-50 stays queued with a `Keep:` because only its first half
is built, and the `Keep:` has to say which half and why the other one is not a small follow-on — an
exposed activity factor without a not-enough-data state is a worse picker than the one it replaces.

The `projectOverview` block is longer than a one-string fix warrants because the fix is not the
interesting part. What is worth carrying is that the model was handed a number, a false account of
how it was made, and enough context to "correct" for a multiplier that was not there.

## 2026-09-02 — `projectOverview.md` → 9304, `docs/implementation-backlog.md` → 15629 (LB-18's source shipped)

Both grow. LB-18 stays queued with a `Keep:` for Lane B's swap, and its `Keep:` carries a
correction rather than just a status: the entry's central claim — that ordering foods and meals by
recency needs a Lane A schema change — was false, and `listSavedMeals` had already solved it by
deriving from `max(food_logs.logged_at)`. That belongs in the entry because the next reader would
otherwise plan the same migration; it is the fourth entry this session whose stated blocker did not
survive being checked.

## 2026-09-02 — `projectOverview.md` → 9315, `docs/agents/state/implementation-lane-a.md` 193 → 92 (session wrap-up)

The baton HALVES, and that is the rewrite rule working rather than a cut. A baton is rewritten in
full each handover, never appended; the previous one had accreted a scan of which entries were
startable on 2026-09-01, all of which had since moved. What replaces it is shorter because most of
what a successor needs is now one link to the handoff.

`projectOverview` grows by a block about entry quality rather than about any of the ten PRs, which
is the right proportion: the code was mostly four-line fixes, and the reason they were four lines is
that six of eight entries turned out to be wrong about something load-bearing.

## 2026-09-02 — `projectOverview.md` → 9328, `docs/implementation-backlog.md` → 15618 (BF-104)

+13 on the index, and the line that earns it is the one about the sheet's own figures. The entry did
not anticipate that shipping a portion picker forces the detail sheet's headline and macro columns to
follow it — that file documents them as what `Log this meal` writes — so a future reader tidying the
scaling away would silently reintroduce a button that does not do what the number above it says.

The 798-against-800 warning is the other half: `saved-meals-sheet.tsx` is not in the size baseline,
so the next addition there fails as a new file over the limit rather than as a tracked hotspot, which
is a confusing failure to meet cold.

Both numbers are higher than the ones this branch first recorded (9305 / 15603, before two rounds of merging main and the off-by-one between `wc -l` and the check's own count) because the
recent-food-items PR landed in between and this is the post-merge count, not a second raise. Its
entry and this one add different blocks, so the merge kept both — the additions case, not the
backlog's two-deletions trap.

## 2026-09-02 — `projectOverview.md` → 9340, `docs/implementation-backlog.md` → 15576 (BF-109)

+12 on the index and **−46 on the backlog**, which is the more interesting half: BF-109's queue entry
was long because it had to argue that the mapper was *correct* and the data wrong, against the obvious
diagnosis an implementer would reach for first. Once that argument has been acted on it belongs in the
journal, and what stays behind is the `Keep:` — a real barcode scan and the device — plus the note that
the fix reaches the photo-scan and manual roads too. The ratchet is set to the new lower number rather
than left at the old headroom, so the gain is locked in.

The index lines are the ones a future reader cannot reconstruct: that OFF's per-100g figure is derived
from the same bad number, so "prefer `_100g`" is not a fix; and that the check and its 15% limit already
existed for this exact failure. Without those two, the next person to see a wrong calorie count starts
from the mapper again.

## 2026-09-02 — `projectOverview.md` → 9355, `docs/implementation-backlog.md` → 15574 (LB-47)

+15 on the index and −2 on the backlog. The index lines are unusually expensive for a copy change, and
they are the ones a future reader cannot reconstruct: **that LB-47's measurement was right and its
conclusion was not**, and specifically that the toggle is not rendered at all on a real session-level
deload because `phase: 'deload'` sets `isDeloadActive`. Without that, the next reader repeats the
entry's inference — the numbers genuinely support it — and ships the fix it proposed, which is already
the behaviour.

The other line worth its cost is that the reachable failure needs a prescription whose `deload` flag
and `phase` disagree, 0 of 5 so far. It marks the fix as latent rather than as a live bug closed,
which is what stops it being struck from Known Issues on the strength of having shipped.

## 2026-09-02 — `projectOverview.md` → 9368, `docs/implementation-backlog.md` → 15597 (LB-38)

Both grow, for a PR that ships no behaviour. The lines that earn it are the ones that stop the next
reader repeating a mistake this session made and caught: **ink is per-style**, and comparing one
style's figure against another's band turns a normal canvas into a mid-repaint signature. That is what
produced a gate that was written, measured and reverted. The four measured figures live in
`darkFraction`'s comment; the index carries only the fact that the comparison is the trap.

The other line worth its cost is that the offline decode came back null under all four configurations,
because it **eliminates** a mechanism rather than adding one — LB-38's list of what is ruled out is now
the useful half of the entry, and the index is where a session decides whether to open it at all.
## 2026-09-02 — `projectOverview.md` 9368 → 9397 (LA-47)

+29 on top of the three raises directly above (BF-109, LB-47, LB-38), all of which landed while this
branch was open — four Current Status paragraphs written the same hour by four sessions. None
displaces another, so each merge kept both sides and the baseline carries the sum rather than one of
them. Re-derived from the file after each merge rather than added to the previous number; the
arithmetic is what drifts, and this entry's own headline was wrong twice before it was measured.

The lines this branch adds are a Current Status paragraph and one Known-Issues row for
LA-47's Coach plan card. Both are index material by the rules that govern this file: a shipped
user-visible change gets a status paragraph, and a change that could not be exercised on the device
gets a Known-Issues row (CLAUDE.md, Canonical Runtime — the row is the *alternative* to the device
smoke run, so it is not optional prose). The detail that is not index material — the design argument,
the verification transcript, the one correction made while building — is in
[`docs/overview/entries/2026-09-02-la-47-coach-plan-card.md`](overview/entries/2026-09-02-la-47-coach-plan-card.md)
and the paragraph links to it.

Both entries shrink on their own terms rather than needing a sweep: the status paragraph is replaced
by the next session's, and the Known-Issues row **moves whole** to `known-issues-resolved.md` the
moment the S25 walk happens.

## 2026-08-30 — `projectOverview.md` 9397 → 9420 (+23), PS-17 and the auto-sync device gate

Two Known-Issues rows, both of which have to be in the file every session reads before it can start.

The first is a live scoring fault: a phantom afternoon "sleep" reached `oura_daily_summary` over the
real night, so 2026-08-27 scored from an HRV of 26.5 and a resting HR of 64 — awake daytime values.
It is long because the row has to carry the evidence: the three phantom sessions, the summary values
either side of the bad day, and the fact that a fix needs a corrective recompute rather than only a
selection change. A shorter row would have been re-derived by whoever picked it up.

The second is the device-verification gate on Colmi auto-sync, which the Canonical Runtime rule
requires: it ships unexercised by any radio, and the row states the one observation that would
confirm it.

Raised to 9420 rather than the exact 9417 so the next small row does not need its own note.

## 2026-09-02 — `projectOverview.md` → 9429, `docs/implementation-backlog.md` → 15585 (Q-407)

Both grow. The index line that earns its cost is the one about the **fallback**: the entry says keep
the stepper reachable, and the obvious way to satisfy that — leave Rebuild as the route back — does not
work, because Rebuild only exists once a plan does. A future reader tidying the second control away
would re-strand exactly the user it was put there for, and nothing in the code says so.

The other is that the scope decides the **tool subset** rather than the prompt. Without it the next
change to this entry point reads `?scope=nutrition` as cosmetic routing and drops it.

## 2026-09-02 — `docs/implementation-backlog.md` → 15593 (Q-407 Keep field + lane re-route)

+4, and they are a **field the runner parses**, not prose. Q-407's Lane B half shipped and the entry
said so in a bullet — but `next-item.js` reads `Keep:`, so without one it kept printing Q-407 at the
head of Lane B's READY list as though nothing had been done. The same shape cost BF-109 a `Lane:` and
a `Verify:` earlier the same day: an entry that describes its own state in prose is invisible to the
tool an implementer is told to start from.

The `Lane:` re-route is the same lesson one level up. The entry has carried a prose paragraph naming
the split (*"`lib/coach/**` is Lane A"*) since 2026-08-30, and the runner never read it — it reads the
`Lane:` field, which said B. With the B half shipped, the entry sat in **neither** queue as work: Lane
B had nothing left to do and Lane A could not see it at all.

## 2026-09-02 — `docs/implementation-backlog.md` → 15655 (LB-38 second capture)

+62, and 26 of them are the failing symbol's 25×25 module matrix as text. That is unusual weight for a
backlog entry and it is deliberate: the `.bin` is 1.4 MB and lives in an ephemeral session scratchpad,
so the matrix is the only durable form of the evidence. The first dump was destroyed before anyone
could re-read it; this is what stops that mattering a second time.

The rest is the measurement table and the render race that is now the leading suspect. Both earn their
lines by **eliminating** work: the table closes off geometry, timing, alignment, format info and the
detector, and the suspect names a mechanism in a specific file rather than leaving the next reader to
re-derive one. Two dead diagnostics are recorded too, because both look convincing and neither
supports anything.

## 2026-09-02 — `docs/implementation-backlog.md` → 15665 (LB-38 render race refuted)

Roughly neutral: the refutation replaces the suspect it kills. That is the point — a lead published in
the morning and measured out in the afternoon should not leave both texts standing, because the next
reader would weigh them against each other instead of reading one answer.

The lines that earn their place are the two measurements: every style logs `len=22` with the same
token, so interleaving cannot produce different data; and eleven clean start/resume/done triples per
run, so it does not interleave anyway. Without them the mechanism reads plausible enough to rebuild.

## 2026-09-02 — `docs/implementation-backlog.md` shrinks by 3 lines (a `Verify:` misuse, corrected)

No baseline raise; this is a removal. BF-105, BF-107 and BF-108 were filed with `- **Verify:** device`
meaning *"this will need a device check once it is built"*. The field means the opposite — the
protocol at the top of this file defines it as **shipped, and awaiting a look** — so `next-item.js`
sorted three unbuilt entries into VERIFY, where an implementer reads them as completed residue and
never starts them. Lane B read **READY (1)** with two of its own items hidden that way. Removing the
bullet puts them back in READY (3); each entry already states its device requirement in its own
verification prose, which is where an unbuilt entry belongs. The script had been printing
`Verify device: no note — say what to look at` against two of them the whole time — a complaint about
a field that should not have been there at all.

## 2026-09-02 — `docs/implementation-backlog.md` 15665 → 15694 (Q-509)

+29, and all of it is structured fields rather than prose. Six entries at the head of Lane A's READY
list stated a real block — a scoring change needing owner sign-off, or a dependency — **in prose
only**, so `next-item.js` served them as startable. Q-289's own Lane bullet says *"not an
implementer's to take at all"* and it was the number-one item. Each now carries the `Gate:` or
`Needs:` its own words already justified, plus one line saying which prose it replaces so the next
reader does not think a field was invented.

The remainder is Q-509's result: the pre-registered experiment ran and failed its pass test, which
belongs in the entry because it changes what the entry is asking for. The argument, the table and
the caveats are in
[`docs/reviews/2026-09-02-recovery-index-ble-smoothing-experiment.md`](reviews/2026-09-02-recovery-index-ble-smoothing-experiment.md);
the entry carries the verdict and the pointer, and was cut by half after this check first failed.

**This is the file's own growth mechanism working as intended** — fields are what make readiness
computable instead of prose, and they cost lines. The lines come back when these entries ship.
