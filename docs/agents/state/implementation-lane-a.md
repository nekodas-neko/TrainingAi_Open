# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-09-13 · **Next ID:** `LA-103`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.
`LA-54` was allocated and withdrawn, so it is used rather than free.)
**Migrations:** directory head **275** — claim against open PRs too, not just the directory.
Local SQLite **v38**.

## Now

Start with `node scripts/next-item.js --lane A --all`. **`--all` is not optional** — the display
truncates READY at 10 and a startable item has sat unnoticed at position 12.

**As of 2026-09-13 READY holds nine entries and all nine are standing exclusions**, so "nothing
startable" is the normal answer until the owner releases something. Do not widen the exclusion list
to find work; it has been widened three times without being asked.

- Owner-gated or parked: Q-220 (Orchestrator's), Q-44 Phase 3 PR 1, Q-1a, LA-95, Q-30, Q-52, Q-28,
  Q-29 Task 5, LA-100, LA-89.
- **LA-91 sits inside the original do-not-take band LA-84..LA-92.**
- Feature work (BF-9 trainer role, BF-7 session-length picker, BF-5 week-in-review page) is a
  different kind of change from a small verifiable fix and is not begun unilaterally.

## One PR is open and must NOT be merged

**#1098 — RV-42, cross-account meal-plan write-path ownership, branch
`lane-a/rv42-meal-plan-child-ownership`.** Green since 2026-09-11, waiting on the owner: it is a
security change, and CLAUDE.md's confirm-first carve-out covers it. Merging auto-deploys to Railway.
Keep it rebased and mergeable only — merge `origin/main` in, re-run the gate, push.

Its two recurring conflicts, sixteen times now: `docs/doc-size/docs/implementation-backlog.md.size`
(overwrite with a bare integer FIRST — `pnpm fix:baselines` **throws** on conflict markers — then run
it) and `docs/doc-size-baseline-history.md` (append-only, so keep BOTH sides with main's first). The
recompute churn is recorded deliberately in the history note; do not tidy it.

## Four owner decisions on the record — do not re-ask them

1. Merge #1098. 2. Drop the dead `program_session_id` column. 3. Release Q-52 and Q-28.
4. ~~The calorie goal, 1350 vs 1660~~ — **answered 2026-09-13 and shipped as BF-152**: he answered
with a rule, not a figure, so the budget anchors to his measured resting rate and reads no typed
number at all. The question evaporated rather than being decided.

## Three device checks owed

- The strap battery chip dims after 3 h (BF-140).
- A bodyweight set at a rep count other than 5 or 6 (BF-151) — both figures render only under
  `isBodyweight`.
- BF-152's provenance line (*"1,815 resting rate"*) — rendered in the dev browser at S25 width on
  both surfaces, never on a phone.

## ⚠ Read this before building anything

**Every entry examined since 2026-09-02 had at least one load-bearing claim that did not survive
contact with the code** — not stale, wrong at filing time. The shape is consistent: **line numbers
have been accurate every time; names, conclusions and "this needs a schema change" have not.** So
grep the symbol, then its callers, then decide. It has removed a whole migration from one entry.

BF-152 (2026-09-13) is the exception worth knowing — every arithmetic claim in it held, including
the production figures. An entry *can* be right; it still has to be checked.

## Testing, and the four things that have cost a session each

- **Run the suite with `DATABASE_URL` set** (`postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433`).
  Without it ~190 DB-backed files SKIP silently: 700 files pass instead of ~896. Capture the real
  exit code (`pnpm test > log 2>&1; echo $?`) — piping to `tail` reports tail's.
- **`db-snapshot-integration.test.ts` skips locally even with `DATABASE_URL`** (it needs the
  `claude_readonly` role local dev does not create) and fails CI on any migration adding a column to
  a table the `claude_ro` views cover. **Every such migration needs its regenerated twin in the SAME
  PR** — a NEW number, then diff against the previous to confirm only the intended columns moved.
- **`Build` is NOT enforced as a required check, whatever the documented list says.** #935–#937
  merged with it `in_progress` and all three finished `failure`. Wait for a conclusion on all six,
  and run Build's own steps locally: `pnpm build` **and** `node scripts/check-test-typecheck.js`, not
  just `tsc --noEmit`. Test files typecheck under a separate config, where `vi.fn(async () => …)`
  infers a zero-parameter signature and any cast off `mock.calls[0]` is a hard error invisible to
  `tsc --noEmit`.
- **E2E is advisory, and that is exactly how a regression reached `main`.** BF-150 merged with
  `one-calorie-budget.spec.ts` red on its own pre-merge run; the defect was real and became LB-100.
  Wait for E2E even though nothing forces you to.

## Gotchas

- **`get_check_runs` returning `total_count: 0` has been a STALE BASE every single time** — never
  slow CI. Confirm with `git merge-base --is-ancestor origin/main HEAD`, re-merge, push.
- **Re-merge `origin/main` immediately before opening a PR *and* again before merging.** `main` moved
  between green and merge on four PRs in one session. A stale green is not a green.
- **A stale local `origin/main` looks exactly like a lost edit.** Fetch before believing anything
  vanished.
- **Mutation-test every change, with at least one deliberately equivalent control.** The survivors
  are where the real tests come from. The one to write a test for *before* the pass is the
  service-wiring mutant — which number the service hands the shared formula — because every formula
  test passes through it. It survived BF-150's first pass; BF-152 wrote that test up front and killed
  it.
- **Guards find their own documentation.** Strip comments before scanning source in a test; exempt by
  name with an assertion that the exemption is real.
- **Never `git add -A` before resolving a conflict** — it hides the conflict from `git status`.
