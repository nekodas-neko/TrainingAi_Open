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

- **Entry IDs are `BF-<n>`, counting up forever.** Bands and the shared pointer are both gone (see
  `docs/agents/README.md` §3). Find your next number with
  `grep -rhoE '\bBF-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`. Legacy Q-387…449 stay valid where
  already used — this role's last band entry was **Q-424** (2026-08-20); everything after it is `BF-`.
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
- **To date a regression, `add_repo` the archive** — this repo was cut fresh 2026-08-16, so its
  `git log` cannot. `nekodas-neko/TrainingAI_Old`, 3,225 commits. **Two traps:** it clones
  `--depth 1`, so `fetch --unshallow` first or every `-S` answer is a lie by omission; and a
  caret-ranged dep moves in `pnpm-lock.yaml` without touching `package.json`. Dated BF-4 to #112
  on 2026-08-23, after that entry had merged saying no commit could be named.
- The **probe pattern** for shared modules: import the real module in a scratch `.ts` inside the repo
  (so imports resolve), run it with `npx vite-node <file>`, print a table, delete before committing.
  `tsx` is not installed; `vitest run` ignores a file with no test in it.

## Framework docs

`docs/agents/README.md` is the operating model — §1 defines this role, §2 is the authority table, §4
is the handoff ritual this file is part of. The cold-start prompt is
[`docs/agents/prompts/bugfix.md`](../prompts/bugfix.md). §3 is where the `BF-` ID scheme replacing the
old bands is defined — it landed 2026-08-19, mid-session, which is why an earlier version of this
baton still described a band.

---

## Traps this role hits every session — read before the first PR

- **`check-doc-index-size` fails every intake PR.** Intake adds an entry per report, so it trips every
  time. Raise the baseline in the same PR, but treat the failure as a real signal first and budget
  ~30 lines per queue entry.
- **Baselines live in `docs/doc-size-baseline.json`** (since #254), with the reasoning appended to
  `docs/doc-size-baseline-history.md` — the check's own failure message says both.
- **Take the count from `node scripts/check-doc-index-size.js`, never from `wc -l`** — `wc -l` reads
  **one lower**, and a baseline set from it leaves the branch red. Cost a resolution on 2026-08-19.
- **Two parallel PRs can still each raise the baseline and collide, and `main` can still end up over
  its own number** — the JSON move fixed how *often* that happens, not that it can. CI has no
  `push: [main]` trigger, so nothing looks. Happened on 2026-08-19 and filed as **Q-424**. **If a
  fresh branch fails a check it could not have caused, test `main` before debugging your own diff.**
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
  requirement — intake does not write implementation plans. Q-389 is the shape to copy.
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

| entry | what | state at 2026-08-20 |
|---|---|---|
| **Q-391** | per-session calories on the day screen's Training card — *promoted*, not re-filed, when the owner asked a second time | ✅ **shipped** (#260) |
| **Q-419** | the done screen and the day budget disagree about the same workout; only one reads the RPE | ✅ **shipped** (#252) |
| **Q-421** | HR-based workout energy; ONNX route rejected by the owner | ✅ **route (a) shipped** (#255); route (b) closed by the owner |
| **Q-423** | the per-set RPE prefill is measurably low — 233 raised by hand vs 32 lowered | queued, Lane B |
| **Q-420** | derive session RPE from the set ratings | queued — **re-measured by Lane A (#256), see below** |
| **Q-422** | calibrate the burn against the owner's own energy balance | queued, Tuning → A |
| **Q-424** | a shrink-only ratchet can leave `main` red and nothing looks | queued |

**Three of the six shipped within hours of being filed.** Worth knowing as a calibration on this role:
entries that trace to a file and carry a measurement get picked up fast, so the cost of a vague entry
is not that it sits — it is that it gets built vaguely.

**⚠ One decision recorded in this session was superseded the same day, and the correction is better
than the original.** Q-420's amendment argued *against* mapping the 6–10 set scale onto the 1–10
session scale, on the grounds that the only consumer was the energy tier and inventing a mapping would
be inventing precision. **That reasoning held only for the consumer that was checked.** Lane A's
re-measure (#256) found that Q-421 shipping had gutted the energy case — HR now takes precedence, so
the tier decides the burn on **3** sessions, not 24 — and that the real consumer is
`app/api/health-trends/route.ts:172`, which computes Foster's `sessionLoad = sessionRpe × durationMin`
on the **CR-10** scale. A value floored at 6 fed into that **systematically inflates session load**,
and ACWR thresholds downstream are calibrated on the unscaled figure. **There the mapping is not
optional; it is the whole item.** The lesson for this role is narrow and reusable: *a decision about a
number is only as good as the enumeration of who reads it* — grep every consumer before ruling one
out.

**The owner decision that does stand: no Oura models.** Q-421 keeps the closed-form Keytel estimator.
It does **not** extend to `estWorkoutKcal`, which is a ported formula rather than a model; widening it
needs asking. Carry Lane A's caveat too — Keytel is fitted on steady-state aerobic subjects and
over-reads for intermittent resistance work (a 150 bpm probe returned 823 kcal, against an observed
max of 104 bpm).

**Nothing mid-triage. Nothing received-but-unfiled. Nothing blocked on the owner.**
