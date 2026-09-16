# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-09-16 · **Next ID:** `LA-116`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.
`LA-54` was allocated and withdrawn, so it is used rather than free.)
**Migrations:** directory head **275**, so the next free number is **276** — claim against open PRs
too, not just the directory. Local SQLite **v38**.

**⛔ A COLUMN RENAME IS NOT AVAILABLE IN THIS REPO. Learned the hard way 2026-09-16 (LA-114), one
CI cycle.** Migration Check's second step replays every migration against a schema that already has
everything, and the `claude_ro` view migrations (213, 215, 218, 221 … 274) each regenerate the FULL
view set — so every one of them names every column. Rename a column and a dozen historical
migrations fail on replay. Editing them is not available: `ensureSchema` tracks by FILENAME.
`migrate.js` has a `REPLAY_EXEMPT` hatch whose single entry is itself a rename, so the escape exists
and using it means exempting a dozen files from the check that caught you. **And: a migration is not
tested until it has been applied TWICE to the same database.** `pnpm test` and `check:rules` both
pass against a DB where the migration already ran. Reproduce CI locally on a throwaway DB:
`CREATE DATABASE ci_replay` → `migrate.js` → `TRUNCATE schema_migrations` → `migrate.js --replay`.

## Now — re-run the runner; this section is a snapshot and goes stale within hours

**⚠ Every previous baton's "N are startable" list has been wrong in both directions.** Start with
`node scripts/next-item.js --lane A --all`. **`--all` is not optional** — the display truncates READY
at 10 and a startable item has sat unnoticed at position 12. As of 2026-09-16 READY is 13; top four
were TN-29, TN-25, LA-76, RV-42.

**⚠ READY does not mean startable, and the runner cannot tell you so.** A dependency written as a
SENTENCE is invisible to it. TN-31 sat at the **top of READY** while blocked behind two entries,
because its own text said *"Sequence TN-30 first"* rather than carrying `Needs: TN-30`. Fixed
2026-09-16. **Before starting anything, read the entry for a prose dependency** — and if you find
one, convert it to a field in that PR rather than just obeying it.

### The pattern that decided most of this session's work

**Four entries this session had true measurements and wrong conclusions.** In each case the
correction came from re-verifying against current state rather than re-reading the entry:

| entry | its claim | what was true |
|---|---|---|
| LB-110 | work outstanding | shipped three days earlier under another path |
| LA-110 | cause identified | real cause was a dated window of logs with no `planned_pct` |
| TN-44 | "add ten types to a list" | the plugin's converter, not the list, is the wall |
| TN-37 | "drop two dead Cloud reads" | both load-bearing; one feeds the HRV/RHR wear filter |

**The reusable forms:** absence from a queue that removes completed entries is the signature of
*finished*, not lost. *"Every scored column is NULL"* is not *"the table is dead"* — check for a live
writer. And **read the pinned dependency's source, not its docs**, before believing a claim about an
external API.

### Owner-gated, unchanged

| entry | blocked by |
|---|---|
| LA-76 | owner decision: does a deload span become first-class stored state? Its own entry says ask before writing the migration. The *session* half is already true — `listTrainedDayKeys` has no `phase_type` filter. |
| RV-42 | is PR #1098 — built, green, owner-gated. **Keep it rebased and mergeable; never merge it.** |
| LA-113 | the daytime-HRV level gap. Needs a controlled same-instrument capture (strap at rest, in the ring's own HRV window), not a coefficient change. |
| Q-220 · Q-1a · Q-29 · Q-28 · BF-9 | unchanged — re-check each entry, do not widen |

### Owed to the owner, and none of it is yours to fire

- **BF-13's re-derivation run.** `POST /api/admin/rederive-baselines` shipped 2026-09-16 (#1254),
  `dryRun` by default. It is a production data write. All four `temperature-baseline` entries
  (BF-13, TN-6, Q-506, TN-8) stay queued until it runs — their pass tests are unmeasurable before it.
- **LA-112's effect size.** The sleep-exclusion fix shipped (#1256, v1.457.2) and history self-heals
  across the trailing 21 days, but only `level` is persisted, never `dhrv`, so the magnitude could
  not be predicted. Owner check owed.
- **LA-115** needs an APK and a Health Connect permission grant.

**LA-91 sits inside the original do-not-take band LA-84..LA-92.** That band was widened three times
without the owner asking. Do not widen it again.

**PS-4 will always print UNCLASSIFIED and that is correct** — each role rewrites its own baton, so it
is not implementer work. This baton sits just inside PS-4's ~150-line target with little room, so
compact it on the next rewrite rather than letting it cross — `wc -l` is the check, and a number
written here would be wrong by the next edit (it was, twice, while this was being written). Review,
BugFix and Tuning are all over, and each is that role's to fix.

## One PR is open and must NOT be merged

**#1098 — RV-42, cross-account meal-plan write-path ownership, branch
`lane-a/rv42-meal-plan-child-ownership`.** Green since 2026-09-11, waiting on the owner: it is a
security change, and CLAUDE.md's confirm-first carve-out covers it. Merging auto-deploys to Railway.
Keep it rebased and mergeable only — merge `origin/main` in, re-run the gate, push.

Its two recurring conflicts, **twenty-odd times now**: the `.size` file (overwrite with a bare
integer FIRST — `pnpm fix:baselines` **throws** on conflict markers — then run it) and
`doc-size-baseline-history.md` (append-only: keep BOTH sides, main's first).

**Verify the merge by BODY phrase, not by heading diff.** This PR only *removes* a heading, so a
heading diff against `main` proves nothing about its body edits — and that is not hypothetical: a
body-only edit to PS-41's owner gate was silently dropped by a merge that passed the heading check
(recovered in #1207). Grep a distinctive phrase from every body you touched.

## Owner decisions on the record — do not re-ask them

1. Merge #1098. 2. Drop the dead `program_session_id` column. 3. Release Q-52 and Q-28 — **note Q-52
is now parked on `Needs: LA-110` regardless**. 4. LA-76: a deload must not decay the collection
(2026-09-14). 5. The calorie anchor: **settled by BF-152** — a rule, not a figure, so the budget
reads his measured resting rate and no typed number; confirmed on the S25 2026-09-15.

**Open and waiting on the owner:** #1098 · BF-9's go-ahead · LA-76's stored-span question ·
PS-41 · LA-110 · BF-100's one-tap experiment.

**PR #124 is MERGED (2026-08-23)** — BF-9's entry claimed it was open and awaiting the owner, which
cost nothing only because it was caught. Its check, CI wiring and test are all on `main`.

## Device checks owed

Carried from the previous baton and this session, not re-verified here: BF-140 (strap battery chip
dims after 3 h) · BF-151 (a bodyweight set at a rep count other than 5 or 6) · BF-152's provenance
line · BF-58 · LA-48 · BF-164 · PS-42. **BF-5 PR 2a needs none** — server/JS only, no offline-first,
native, safe-area, gesture or notification surface.

## ⚠ Read this before building anything

**Every entry examined since 2026-09-02 had at least one load-bearing claim that did not survive
contact with the code** — not stale, wrong at filing time. The shape is consistent: **line numbers
have been accurate every time; names, conclusions and "this needs a schema change" have not.** So
grep the symbol, then its callers, then decide. It has removed a whole migration from one entry.

**And re-read your own plan against its entry before building from it.** On 2026-09-15 a plan
shipped whose §7 exempted a migration from a gate the entry set, by quoting the entry's own sentence
and inverting it (corrected in #1223). A full green gate cannot catch that; only re-reading can.

BF-152 (2026-09-13) is the exception worth knowing — every arithmetic claim in it held, including
the production figures. An entry *can* be right; it still has to be checked.

## Testing, and the four things that have cost a session each

- **Run the suite with `DATABASE_URL` set** (`postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433`).
  Without it ~190 DB-backed files SKIP silently: 700 files pass instead of ~920. Capture the real
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

## A red run with ZERO failing tests is not your change

Two distinct local-DB artifacts, both catalogued in `docs/local-dev-database.md`, both settled by a
re-run rather than by diagnosis:

- **`EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`** — **eight**
  sightings across four distinct files, of which `hr-read-routes.test.ts` accounts for **five**.
  Re-run: clean eight for eight. It is over-represented rather than solely responsible, so its
  fire-and-forget `upsertWorkoutHrStats` is the best lead if anyone traces it — not a cause.
- **`error: deadlock detected` in a migration test** — ONE failing test, not zero, which is what
  tells it apart. Seen 2026-09-15 on a **markdown-only** diff, which is what ruled the change out.
  Do not serialise the suite or retry the query; CI uses a fresh database.

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
  test passes through it.
- **Prove a behaviour-preserving refactor by RUNNING both versions, not by reading them.** BF-5's
  engine half ran one fixture through `origin/main`'s route and the rewritten one and diffed the
  output. A transcription checked against itself proves nothing.
- **Guards find their own documentation.** Strip comments before scanning source in a test; exempt by
  name with an assertion that the exemption is real.
- **Never `git add -A` before resolving a conflict** — it hides the conflict from `git status`.
- **`git reset --hard` is on CLAUDE.md's never-without-confirmation list.** Use
  `git checkout -B main origin/main`, which is the repo's own prescribed ritual and equivalent.
