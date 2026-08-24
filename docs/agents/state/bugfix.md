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
  `grep -rhoE '\bBF-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`. This role's last band entry was
  **Q-424** (2026-08-20); everything after it is `BF-`. **Current: `BF-9` filed, next is `BF-10`.**
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
  someone else's work.
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

Filed **BF-1** (blood panels, gated), **BF-2** (DEXA filter), **BF-3** (dosed substances), **BF-4**
(scan slowdown, dated to `#112` via the archive), **BF-5** (week-in-review page), **BF-6** (finished-
logging unreachable — **shipped, #355**), **BF-7** (session-length slider, owner settled the anchor),
**BF-8** (Intensity vs auto-deload — **owner-confirmed from experience, shipped, #353**), **BF-9** (a
trainer role — design + population approved by the owner). Also merged **PR #124**, another session's
stale-but-approved auth fix.

**Seven entries remain queued** (`BF-1/2/3/4/5/7/9`). Nothing waiting on the owner, nothing
mid-triage.
