# 🪲 BugFix Intake Agent — baton

> **Successor sessions are titled `🪲 BugFix Intake Agent 🟢`** — exactly, emoji included. The title is
> how five concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton. **Flip your own light to 🔴 once this baton and every PR have landed** — see
> `docs/agents/prompts/bugfix.md`, the last two paragraphs.

The standing intake role. Owner reports (screenshots, descriptions, "why is this doing that") come
in; each leaves as a traced backlog entry in `docs/implementation-backlog.md`, landed and merged in a
docs-only PR. **This role does not fix.** A fix that skipped the queue is one nobody else can see
coming.

Rewrite this file **in full** — never append — before the session ends or context runs out.

---

## Standing facts for this role

- **Entry IDs are `BF-<n>`, counting up forever.** Bands and the shared pointer are both gone (see
  `docs/agents/README.md` §3). Find your next number with
  `grep -rhoE '\bBF-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` — **run it, do not trust this line**,
  which was four sessions stale before it was noticed. This role's last band entry was **Q-424**
  (2026-08-20); everything after it is `BF-`. **Current: `BF-88` filed, next is `BF-89`.**
- **No migration numbers.** Intake never claims one. If an entry needs a corrective migration or a new
  column, say so in the entry and hand the number to Lane A.
- **Docs-only PRs, opened and merged without asking** (CLAUDE.md Standing Instructions). CI still has
  to be green; a markdown-only PR runs the full pipeline, because the `pull_request` trigger has no
  `paths-ignore`.
- **Entry model to copy: Q-310, Q-420/Q-423, and now BF-9.** Owner report verbatim + screenshot
  described in words + traced file/line + measured evidence + why it is one bug with N symptoms + fix
  direction + what would count as done. For a feature request, add the design recommendation and any
  owner decision recorded verbatim — `BF-9` is the fullest example: design approved, population
  accepted, and what the acceptance does *not* cover, all inside one entry.
- **Dedup before filing** — `grep` the backlog *and* `projectOverview.md`'s Known Issues. If it is
  already filed, amend that entry in place with the new evidence. Promoting an existing entry and
  appending a note is the correct move when the owner repeats a request; filing a second number is the
  failure this repo has already had (Q-397).
- **Escalate loudly, don't just file**, if a report reveals something destructive already happening in
  production: data loss, a security hole, auth breakage.
- **An entry can vanish from the queue between one check and the next — that's success, not
  corruption.** If `grep` for your own ID comes back empty, `git log -S"<ID> —" --
  docs/implementation-backlog.md` before assuming a bad merge dropped it — it may just be shipped.

## Tools available for tracing

- `pnpm dev` against seeded local Postgres (port 5433, `.env.local`; `DATABASE_URL`/`DATABASE_SSL`
  must be unset in the shell first — the session-start hook does this).
- `pnpm e2e` — the E2E harness (Q-249).
- `POST /api/admin/db-query` over the `claude_ro` views for production. **Row-scoped to one user and
  pruned at 30 days** — every count from it is "the owner's, recently", never "the system's". Write
  findings that way. It is the single highest-value tool this role has — turned "the scan feels
  slower" into a clean split by call-shape (`BF-4`) and "0 of 55 days marked" (`BF-6`) in a handful of
  queries each.
- **To date a regression, `add_repo` the archive.** This repo was cut fresh 2026-08-16, so its own
  `git log` cannot answer "when did this change" for anything older; `nekodas-neko/TrainingAI_Old`
  (3,225 commits) can. **Two traps:** it clones `--depth 1`, so `git fetch --unshallow` first or every
  `git log -S` answer is a lie by omission; a caret-ranged dep (`^8.2.0`) can move in
  `pnpm-lock.yaml` without touching `package.json` — check the lockfile, not the manifest.
- The **probe pattern** for shared modules: import the real module in a scratch `.ts` inside the repo
  (so imports resolve), run it with `npx vite-node <file>`, print a table, delete before committing.
  `tsx` is not installed; `vitest run` ignores a file with no test in it.
- `mcp__github__list_pull_requests` (search-backed) can report stale `merged: false` on a PR already
  confirmed merged. Trust `pull_request_read` `method: get` on the specific number instead.

## Framework docs

`docs/agents/README.md` is the operating model — §1 defines this role, §2 is the authority table, §4
is the handoff ritual this file is part of. The cold-start prompt is
[`docs/agents/prompts/bugfix.md`](../prompts/bugfix.md) — **read it fresh every session**, not from
memory; it changed mid-session on 2026-08-24 to add the status-light title convention (see below), and
will keep changing as the framework does. §3 of the README is where the `BF-` ID scheme is defined.

---

## Traps this role hits every session — read before the first PR

- **`check-doc-index-size` fails almost every intake PR.** Raise the baseline in the same PR —
  reasoning in `docs/doc-size-baseline-history.md` — but treat the failure as a real signal first.
  **Recompute after merging `origin/main` in, not just before**: a raise can evaporate if a parallel
  PR shrinks the same file first; if it does, say so in the history file rather than deleting the
  reasoning. Take the count from the script, never `wc -l` (reads one lower).
- **`get_check_runs` returning `total_count: 0`** — a stale base, or checks queuing on a push you just
  made. `git log --oneline HEAD..origin/main` tells them apart. Fires constantly on a busy night
  (several lanes committing every few minutes); not a stall.
- **A stacked PR conflicts once its parent squash-merges — verify before resolving, never `--ours`
  blind.** Confirm `main`'s side of the hunk is genuinely empty, then check `grep -c "^### .*<ID> —"`
  gives 1 and `git diff --stat origin/main` shows insertions only. A bad splice silently reprioritises
  someone else's work. **A CLEAN auto-merge needs the same check** — one this session auto-merged with
  no markers at all while carrying an entry `main` had just deleted. The check that catches it:
  `diff <(git show origin/main:docs/implementation-backlog.md | grep '^### ') <(grep '^### '
  docs/implementation-backlog.md)`, which for an amendment-only PR should be **empty**.
- **A shallow clone re-forms after every container restart** and produces two false alarms: `git
  merge origin/main` refuses with "unrelated histories", and `git diff --stat origin/main` shows
  phantom deletions across untouched files — reads like reverted work, isn't. `git fetch --unshallow
  origin` fixes both; check `.git/shallow` first.
- **When `main` moves every few minutes**, expect to merge it locally two or three times per PR, and
  expect `update_pull_request_branch` to hit a real conflict once it does. Merge locally, resolve,
  push, re-verify green on the fresh head.
- **Merging someone else's open PR needs its own explicit go-ahead**, even under a broad "go with your
  recommendation" — that covers this role's own entries, not another session's branch. Ask once,
  specifically.
- **⛔ NEVER CONCLUDE A NEGATIVE FROM `grep … | head -N`. This cost two false findings on 2026-09-01,
  and one of them reached CLAUDE.md.** First: *"there is no Sentry"* — five component files matched
  the substring inside `MuscleSets**Entry**`, `package.json` was further down the truncated list, and
  `@sentry/nextjs` was installed all along. Then, an hour later and unlearned: *"`error_events` never
  prunes"* — `head -5` showed `pruneExpired` and `pruneOldThreads`, while
  `adapter.ts:5093` holds `DELETE FROM error_events WHERE created_at < now() - interval '30 days'`.
  That one was written into the session-start rule every agent reads, and Lane A had to retract it
  (#737). **A claim that something does not exist requires the COMPLETE result set** — pipe to
  `wc -l`, or drop the `head`, and read the count before writing the sentence. `head` is for
  previewing a positive finding, never for establishing an absence.
- **⛔ CONFIRM THE RESPONSE YOU FETCHED IS THE PAGE YOU MEANT. Third false negative of 2026-09-01,
  same family as the two above.** *"`NEXT_PUBLIC_SENTRY_DSN` is not set"* came from `curl`ing
  `/login` and grepping for an ingest host. `/login` is a **52-byte redirect stub**. A redirect
  answers "not found" to every grep, and the claim went into a backlog entry telling an implementer
  to set a variable that was already set. Re-measured with `curl -sL` against the real page and its
  **33 JS chunks**, the DSN is inlined in three of them. **Check `wc -c` on what you downloaded
  before you search it** — and remember `NEXT_PUBLIC_*` lands in the JS chunks, not the HTML, so the
  page alone is never enough.
- **⛔ Measure a retention window from the LAST WRITE, not from `now()`, when the prune fires off a
  write path.** The same 2026-09-01 finding had a second, independent error: *"oldest row is 32 days
  old against a claimed 30"* compared the row against **today**. The prune runs inside
  `insertErrorEvent`, throttled to once a day, so it only fires when something is written — and with
  faults rare, the oldest row ages past the window between writes. Measured properly: last write
  2026-08-30, oldest row 2026-07-31, span **exactly 30 days**. **The evidence that looked like a
  broken prune is what a working write-triggered prune looks like.** Before calling any retention
  broken, find what triggers it and measure against that.
- **A `send_later` check-in can fire stale.** Verify checks and base freshness before acting on it.

## Method notes worth reusing

- **Query the distribution before believing a mechanism.** Tag totals supported the wrong answer for
  Q-388; the hour-of-day breakdown refuted it. Splitting `ai_call_log` by call-shape (image vs text
  tokens) is what let `BF-4` rule out the AI call as the regression in one query.
- **When a module has a guard against a *related* case, read that guard's comment before assuming it
  covers yours.** `BF-8` is the freshest example: `pre-workout-screen.tsx` hides the Intensity toggle
  for a *phase* deload, and reading that guard's own comment is what revealed it has no equivalent for
  a deload the prescription applies on its own.
- **Check the owner's incidental remarks against the code.** A remark that isn't the report itself can
  still invalidate an assumption already written into an entry — read every reply for content, not
  just for a yes/no.
- **A feature request is still filed**, but say so in the entry and point at the planning-session
  requirement — intake does not write implementation plans. `BF-1`, `BF-5`, `BF-7`, `BF-9` are all this
  shape right now.
- **Do not fit to a target the owner has just told you is unreliable**, and do not treat a small,
  known, all-consenting user population as a reason to relax an ownership guard — those are two
  different kinds of "the owner said it's fine", and only one of them changes what the code has to
  check. `BF-9`'s entry states this explicitly because the temptation to conflate them is real.
- **A refused proposal is not a closed subject — the owner's next one may be right.** Two energy-model
  changes were proposed an hour apart and they are not the same change (BF-88): the first deleted 265
  kcal of base and handed back 102; the second removes exactly what it hands back. Measuring the first
  is what produced the second. **Name the version you measured**, so "we said no to this" cannot be
  quoted against a better idea later.
- **Delete a superseded recommendation; never leave it beside its replacement.** When BF-88's advice
  changed, BF-87's "do not lower `STEP_BASELINE`" was rewritten in the same diff. A stale prohibition
  that is still obeyed is worse than no entry — that one would have made an implementer refuse a
  change the owner had approved.
- **Compute the owner's numbers through the real module, not by hand** — the probe pattern above,
  then delete the scratch file. Hand arithmetic gave 35 kcal/1,000 steps; `computeActiveEnergy` gave
  34, and the table is now something an implementer checks against instead of re-deriving Schofield.
- **A dated regression needs the archived repo, not the live one, once the live repo's own history is
  too short.** See the tool note above — this is now a first move, not a last resort.

---

## Session log

### 2026-08-17 — first session under this role

Filed **Q-387** (`[nutrition]` adaptive-TDEE counts a partially-logged day as complete), **Q-388**
(`[devices][heart-rate]` ring battery drains ~3.5× stock), and **Q-389** (`[nutrition][app-shell]`
printable food labels).

### 2026-08-19/20 — the workout-energy cluster

Six entries from one owner question plus two screenshots. Full narrative in
[`docs/handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md`](../../handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md).
Three of six shipped within hours. One decision (Q-420's set-scale mapping) was superseded the same
day by a re-measurement that checked a consumer nobody had enumerated — the lesson: *a decision about
a number is only as good as the enumeration of who reads it.*

### 2026-08-23/24 — nine entries, a trainer-role design, and one rescued PR

Full narrative in
[`docs/handoff-2026-08-24-cross-bugfix-nine-entries-trainer-role-and-admin-fix.md`](../../handoff-2026-08-24-cross-bugfix-nine-entries-trainer-role-and-admin-fix.md).

Filed **BF-1** (blood panels), **BF-2** (DEXA filter), **BF-3** (dosed substances), **BF-4** (scan
slowdown, dated to `#112` via the archive), **BF-5** (week-in-review), **BF-6** (finished-logging
unreachable — shipped, #355), **BF-7** (session-length slider), **BF-8** (Intensity vs auto-deload —
shipped, #353), **BF-9** (trainer role, design approved). Also merged **PR #124**, another session's
stale-but-approved auth fix.

### 2026-08-25 → 08-27 — the long nutrition + clinical session (BF-10 → BF-46)

**Where the queue stood at the time** — superseded, see the 2026-08-31/09-01 entry below. Do not
work from this paragraph: run `node scripts/next-item.js --lane <A|B>`, which is the only thing that
knows what is startable right now.

**Owner decisions taken this session — recorded in the entries, do not re-open:**

| Decision | Where |
|---|---|
| Dark only; one design. Keep the light palette, do not delete it | CLAUDE.md, *Visual consistency & theme* |
| Warning row = option A (amber triangle before the calorie column) | Q-406, journal `2026-08-26-warning-row-decision.md` |
| Food images: barcode → OFF shot · photo → the photo · text → generate. **Store bytes, not the URL**; the image lives where its ownership does | BF-35 |
| Store **every field** of RMR/DEXA/blood; how to use it is decided later | BF-43 |
| Ingredients read in **weight only**; portions belong to the meal | BF-46 ② |
| Quantity sheet = **option A** (total leads, three macro tiles) | BF-46 ③, drawn at <https://claude.ai/code/artifact/9388bd52-37e4-4986-b145-45cf96c5c3cb> |

**The clinical measurements are in the repo, de-identified**, at
[`docs/clinical-baseline-2026-08-27.md`](../../clinical-baseline-2026-08-27.md) — DEXA and RMR
(2026-08-27) and a 58-analyte blood panel (2026-04). **The owner's name and DOB were on the RMR
report and must never enter this repository.** Three numbers a successor should not re-derive: the
scale under-reads body fat by **3.2 points** (DEXA 28.5 vs Renpho 25.3, same day); measured RMR
**1325** against Cunningham's **1481** on the owner's own DEXA lean mass, so the over-estimate is not
a composition error; and learned maintenance **1,827** lands within **5 kcal** of the provider's Mild
projected TDEE, implying an activity factor of ≈**1.38**.

**Two open threads.** BF-46's photo **save failure is unexplained** — every layer reads correct in
source, so it is device-only; the entry names the candidates and the one check that splits a write
bug from a render bug. And four shipped items owe a device pass: BF-34, BF-27, BF-24, BF-26.

### 2026-08-31 → 09-01 — the energy-model session (BF-86 → BF-88)

Narrative in [`docs/overview/entries/2026-09-01-energy-model-intake.md`](../../overview/entries/2026-09-01-energy-model-intake.md).

**Filed and merged:** **BF-86** (#714), **BF-87** (#715, amended #721), **BF-88** (#718, amended #721).

**Owner decision — recorded in BF-88, do not re-open:** subtract the first 3,000 steps' worth of kcal
from the resting base, then count steps from **zero**. Approved 2026-09-01, `Gate: owner` cleared.
**BF-88 is Lane A's #1 READY item.**

**Numbers not to re-derive** (all in BF-88): step→kcal is **~34 per 1,000** above the floor; the
*uncompensated* version (multiplier → 1.0) loses on **124 of 124 days**, mean **−177**; the
*compensated* one is **identical at and above 3,000 steps** — 74 unchanged, 50 moved, **−17 across all
days**. **102 kcal is the owner's number, not the app's** (`stepKcal(STEP_BASELINE)` at his own
age/weight/sex) — hardcoding it mis-bases every other account. **50 of 124 days sit below 3,000
steps**; **45 of 124** carry a plausible food log, which is what makes a TEF-from-intake term
unusable.

**BF-87 SHIPPED FIRST (#725) AND THE INVERSION LOST THE RACE.** BF-88 was made to precede BF-87
precisely so the copy would not be written against a threshold about to be removed; Lane B merged
BF-87 before that PR landed. Three sites now print *"steps above 3,000/day"* and **BF-88 owns
rewriting them** — it is in the entry, not a follow-up. **The mirror test does not protect this**:
BF-87 mirrored `STEP_BASELINE` into `components/nutrition/movement-breakdown.ts` (LB-43 is why) and
the test pins the two *values* equal — but BF-88 can leave the value at 3,000 while changing what it
means, so the test stays green and the copy becomes a lie. The lesson is general: **a reorder only
protects work that has not started, and a `Needs:` added after a lane has picked the item up is
already too late.**

**Owner still owes:** device checks on **BF-61**, **BF-62**, **BF-63**, **BF-45**, **BF-53**; the
**BF-83** sleep check next morning (note the end time on open, then query the row immediately); and
the Orchestrator prompt, handed over but never run.

## What this session learned that the traps list did not already say

- **Trace before filing, and expect the count to shrink.** Eight owner reports about the Nutrition tab
  became fewer causes: *"adding an image doesn't show it"* and *"the photo should be at the top"* are
  one thing, and *"an AI meal floods the list"* was **BF-39**, already filed. Filing eight numbers
  would have buried the two real bugs among six duplicates.
- **Ask which surface, not just what.** *"Many of the nutrition screens have thin gutters"* read as a
  per-screen sweep; asked, the owner meant **bottom sheets** — one shared component, one change. The
  question cost a sentence and removed most of the work.
- **Draw a layout rather than describing it.** Twice now (the warning row, the quantity sheet) the
  owner's answer to prose was *"can you show me"*, and a drawing settled it in one message. Record the
  choice as a **band-by-band table with the drawing as the tiebreak** — prose is what sent BF-46 round
  the first time.
- **Correct a wrong diagnosis in place, out loud.** This session guessed the photo picker was never
  found; the owner had found it and saved. The entry now says the earlier reading was wrong and why,
  because deleting it would let the next session re-make it.
- **Answering an owner's question is an intake activity.** *"Do exercise calories add on correctly?"*
  was a question, not a report — and checking it found **BF-42**, a live path that never reads the
  measurement BF-33 shipped.
- **Say what already exists.** Most of the injury-aware coach the owner described is built
  (`activeInjuredMusclesInSession`, the periodization swap, `injurySafeAlternatives`). **BF-44** says
  so first, then names the one surface that is blind. Re-building it would have been the obvious move.
