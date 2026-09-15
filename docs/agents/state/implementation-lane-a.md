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

**⚠ CORRECTED 2026-09-15 (Orchestrator, OR-116): this said READY was nine and all nine excluded.
READY is 14 and six are startable** — a stale "nothing startable" reads exactly like a true one.

- **Startable, top first: BF-164** (BF-149 fixed one of eight bodyweight surfaces), **PS-41**,
  **PS-42**, **LA-76**, **Q-52**, **Q-28**. LA-76 was released by the owner 2026-09-14 and **half
  needs no migration** — a deload *session* is already dated by `workout_sessions.phase_type`.
- Still excluded: Q-220 (Orchestrator's), Q-44 Phase 3 PR 1, Q-1a, Q-29 Task 5, LA-95, Q-30,
  LA-100, LA-89. **LA-91 sits inside the original do-not-take band LA-84..LA-92.**
- Feature work (BF-9 trainer role, BF-7 session-length picker, BF-5 week-in-review page) is a
  different kind of change from a small verifiable fix and is not begun unilaterally.

## One PR is open and must NOT be merged

**#1098 — RV-42, cross-account meal-plan write-path ownership, branch
`lane-a/rv42-meal-plan-child-ownership`.** Green since 2026-09-11, waiting on the owner: it is a
security change, and CLAUDE.md's confirm-first carve-out covers it. Merging auto-deploys to Railway.
Keep it rebased and mergeable only — merge `origin/main` in, re-run the gate, push.

Its two recurring conflicts, sixteen times now: the `.size` file (overwrite with a bare integer
FIRST — `pnpm fix:baselines` **throws** on conflict markers — then run it) and
`doc-size-baseline-history.md` (append-only: keep BOTH sides, main's first).

## Owner decisions on the record — do not re-ask them

1. Merge #1098. 2. Drop the dead `program_session_id` column. 3. Release Q-52 and Q-28.
4. LA-76: a deload must not decay the collection (2026-09-14). 5. The calorie anchor: **settled by
BF-152** — a rule, not a figure, so the budget reads his measured resting rate and no typed number;
confirmed on the S25 2026-09-15 (*"my expected base value + my excercise bonus calories"*).

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
