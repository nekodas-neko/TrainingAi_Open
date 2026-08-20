# BugFix Intake Agent 🪲 — baton

> **Successor sessions are titled `BugFix Intake Agent 🪲`** — exactly, emoji included. The title is
> how five concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

The standing intake role. Owner reports (screenshots, descriptions, "why is this doing that") come
in; each leaves as a traced backlog entry in `docs/implementation-backlog.md`, landed and merged in a
docs-only PR. **This role does not fix.** A fix that skipped the queue is one nobody else can see
coming.

Rewrite this file **in full** — never append — before the session ends or context runs out.

---

## Standing facts for this role

- **Q number band: 387–449.** Take numbers directly from that band. Do **not** read or update the
  backlog header's "Next free Q number" pointer — that belongs to other lanes, and touching it is how
  two lanes race for a number. **Used through Q-424 as of 2026-08-20; next free is Q-425.** Check the
  open-PR list too — an unmerged PR can already hold a number, which is how Q-141 collided once.
- **No migration numbers.** Intake never claims one. If an entry needs a corrective migration or a new
  column, say so in the entry and hand the number to Lane A.
- **Docs-only PRs, opened and merged without asking** (CLAUDE.md Standing Instructions). CI still has
  to be green; a markdown-only PR runs the full pipeline, because the `pull_request` trigger has no
  `paths-ignore`.
- **Entry model to copy: Q-310, and now Q-420/Q-423.** Owner report verbatim + screenshot described in
  words + traced file/line + measured evidence + why it is one bug with N symptoms + fix direction +
  what would count as done. That is the bar.
- **Dedup before filing** — `grep` the backlog *and* `projectOverview.md`'s Known Issues. If it is
  already filed, amend that entry in place with the new evidence. Promoting an existing entry and
  appending a note is the correct move when the owner repeats a request; filing a second number is the
  failure this repo has already had (Q-397).
- **Escalate loudly, don't just file**, if a report reveals something destructive already happening in
  production: data loss, a security hole, auth breakage.

## Tools available for tracing

- `pnpm dev` against seeded local Postgres (port 5433, `.env.local`; `DATABASE_URL`/`DATABASE_SSL`
  must be unset in the shell first — the session-start hook does this).
- `pnpm e2e` — the E2E harness (Q-249).
- `POST /api/admin/db-query` over the `claude_ro` views for production. **Row-scoped to one user and
  pruned at 30 days** — every count from it is "the owner's, recently", never "the system's". Write
  findings that way. It is the single highest-value tool this role has: on 2026-08-19 it turned "I
  can't judge session RPE" into a measured 25.6% fill rate and a 233-vs-32 correction asymmetry, in
  about four queries.
- The **probe pattern** for shared modules: import the real module in a scratch `.ts` inside the repo
  (so imports resolve), run it with `npx vite-node <file>`, print a table, delete before committing.
  `tsx` is not installed; `vitest run` ignores a file with no test in it.

## Framework docs

`docs/agents/README.md` is the operating model — §1 defines this role, §2 is the authority table, §4
is the handoff ritual this file is part of. The cold-start prompt is
[`docs/agents/prompts/bugfix.md`](../prompts/bugfix.md). The Q band above matches that document's band
table.

---

## Traps this role hits every session — read before the first PR

- **`check-doc-index-size` fails every intake PR.** Intake adds an entry per report, so it trips every
  time. Raise the baseline in the same PR (the precedent the other lanes set — read the comments above
  `BASELINE`), but treat the failure as a real signal first and budget ~30 lines per queue entry.
- **Take the count from `node scripts/check-doc-index-size.js`, never from `wc -l`** — `wc -l` reads
  **one lower**, and a baseline set from it leaves the branch red. Cost a resolution on 2026-08-19.
- **Never edit that baseline by line number.** A `sed -i "902s/…"` hit the wrong line once because the
  baseline had moved to 907. Use a Python replace on the exact string.
- **Expect the baseline to conflict — four times in one session on 2026-08-19.** Working resolution,
  in order: `git merge origin/main` → `git checkout --theirs scripts/check-doc-index-size.js` (keeps
  main's whole file, preserving checks other lanes added) → re-measure → set exactly → re-run
  `pnpm check:rules`.
- **`main` itself can be red and nothing looks.** CI has no `push: [main]` trigger, deliberately, so a
  shrink-only ratchet left stale by two parallel merges surfaces as an unrelated failure on the next
  branch cut from `main`. Happened on 2026-08-19; filed as **Q-424**. If a fresh branch fails a check
  it could not have caused, test `main` before debugging your own diff.
- **`get_check_runs` returning `total_count: 0` has two causes** — a stale base, or checks queuing on a
  push you just made. `git log --oneline HEAD..origin/main` tells them apart in one command.
- **A stacked PR conflicts once its parent squash-merges.** Check whether `main`'s side of the hunk is
  *empty* (an added-on-one-side conflict) before choosing `--ours`, then verify with
  `grep -c "^### .*Q-NNN —"` that each entry appears exactly once and `git diff --stat origin/main`
  shows insertions only. A bad splice silently reprioritises someone else's work, because queue
  position is priority.
- **A `send_later` check-in can fire after the work is done.** Verify state before acting on a stale
  prompt rather than re-doing a merge.

## Method notes worth reusing

- **Query the distribution before believing a mechanism.** Tag totals supported the wrong answer for
  Q-388; the hour-of-day breakdown refuted it and pointed at the real cause.
- **When a module has a guard against a *related* case, read that guard's comment before assuming it
  covers yours.** Both Q-387 protections were real and documented, and the documented rationale is
  what proved the gap.
- **Check the owner's incidental remarks against the code.** On 2026-08-19 the aside *"it auto
  prefills anyways"* turned out to invalidate two assumptions in an entry already written — the rated
  sets were not all judgements, and the scale floor was a clamp rather than an opinion. The remark was
  not the report and would have been easy to skim past.
- **A feature request is still filed**, but say so in the entry and point at the planning-session
  requirement — intake does not write implementation plans. Q-389 is the shape.
- **Do not fit to a target the owner has just told you is unreliable.** Q-420 was going to be
  calibrated against 20 paired sessions until the owner said they cannot judge that scale; the stored
  data agreed (only 7, 8, 9 ever used). The paired data became a sanity check.

---

## Session log

### 2026-08-17 — first session under this role

Filed **Q-387** (`[nutrition]` adaptive-TDEE counts a partially-logged day as complete; measured 6
partial days of 14 → 514 kcal low with every gate passing), **Q-388** (`[devices][heart-rate]` ring
battery drains ~3.5× stock; traced to `enableMeasurementSequence()` setting DAYTIME_HR + SPO2 +
REAL_STEPS → AUTOMATIC unconditionally, with SpO₂ confirmed as the largest event source and ~75% of
it in the reported overnight window), and **Q-389** (`[nutrition][app-shell]` printable food labels;
the intake value was proving the app already reads QR, making "scan it back" exact and free).

### 2026-08-19/20 — the workout-energy cluster

One question from the owner — *"how can we make energy usage/burned from excercuse more accurate.
what type of data can we feed to calibrate it over time"* — plus two screenshot reports either side of
it. Output: **six entries, five merged PRs**, all docs-only. Full narrative, measurements and gotchas
in
[`docs/handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md`](../../handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md).

| entry | what | lane |
|---|---|---|
| **Q-391** | per-session calories on the day screen's Training card — *promoted*, not re-filed, when the owner asked a second time | A |
| **Q-419** | the done screen and the day budget disagree about the same workout; only one reads the RPE | A |
| **Q-423** | the per-set RPE prefill is measurably low — 233 raised by hand vs 32 lowered | **B** |
| **Q-420** | derive session RPE from the set ratings — 20 of 78 sessions rated vs 625 of 1,047 sets | A |
| **Q-421** | HR-based workout energy; ONNX route rejected by the owner | A |
| **Q-422** | calibrate the burn against the owner's own energy balance | Tuning → A |
| **Q-424** | a shrink-only ratchet can leave `main` red and nothing looks | A |

Two owner decisions are recorded in the entries and must not be re-litigated: **no Oura models**
(Q-421 keeps the closed-form HR estimator only — but note this does *not* extend to `estWorkoutKcal`,
which is a ported formula rather than a model, and widening it needs asking), and **the derivation for
Q-420** (plain rounded mean of a session's rated sets, kept in set-RPE units, no mapping onto the
1–10 session scale).

**Nothing mid-triage. Nothing received-but-unfiled. Nothing blocked on the owner.**
