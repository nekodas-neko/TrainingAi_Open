# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. A
> renamed successor is a lost thread even with a perfect baton.

**Updated:** 2026-09-26 · **Next ID:** `LA-153`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.
`LA-54` was allocated and withdrawn, so it is used rather than free.)
**Migrations:** directory head **285**, next free **286** — claim against open PRs too. Local
SQLite **v40**.

## ⛔ Two things this baton got wrong, which is the warning

**PR #1098 merged on 2026-09-20.** This file and the 4-hourly Routine both carried it for six days
as "the live owner-gated PR, keep rebased, never merge". Nobody was rebasing a merged branch, but
the instruction was false and would have wasted the next session's first ten minutes. **Never carry
a PR number as standing state — re-derive open PRs from the API.** The Routine's copy was rewritten
2026-09-26 to identify owner-gated PRs from the PR itself rather than a list.

**That Routine also asserted READY had been "entirely exclusions" since 2026-09-12.** On 2026-09-26
READY held **74** and four items shipped in one afternoon. A cached queue verdict is worse than
none. Also corrected.

## Required checks — measured 2026-09-26, and this contradicts the old baton

**Required: Lint · Tests (a gate over 4 shards) · Build · Custom Rules · Migration Check.**
`merge_pull_request` refused #1721 with *"Required status check Build is in progress"*, so Build IS
enforced now whatever an older note said.

**E2E is NOT required.** #1726 merged with E2E red. Read it anyway — it is real information.

**The reliable green check is attempting the merge.** It validates against branch protection and
refuses with the reason, so it cannot merge an unready PR. The run-level `status` lags 30+ minutes
and has read `in_progress` on runs whose jobs had all finished — read JOB-level conclusions from
`list_workflow_jobs`, never the run's status.

**`main` merged eight times in three hours on 2026-09-26.** Re-merge immediately before opening a
PR *and* again before merging. `total_count: 0` minutes after opening is a stale base, never slow CI.

## The pattern that decided every item this session

**Four consecutive entries had sound measurements and wrong conclusions.** Each correction came
from re-verifying against current code, not from re-reading the entry:

| entry | its claim | what was true |
|---|---|---|
| TN-83 | 10.9 announcements/30 nights | counted over ROWS, not nights; the fix RAISED it to 15.7 |
| LA-148 | 4 medians, the `0`-on-empty is the defect | 14 medians; that branch was dead, the live defect was an undocumented upper-middle tie-break biasing the HR readout |
| RV-201 | replace an AI call | the route was also feeding the model `[object Object]` for every readiness contributor, live in production |
| LA-151 | `acwr.ts` "feeds training-load advice" | its value is never read — Q-190 took the volume lane off it. **This lane wrote that entry the same day.** |

**Your own entry, written hours ago, is not exempt.** Re-verify it like anyone else's.

**The corollary that keeps paying:** a cast on a row read from JSONB is an assertion nothing checks.
`as Record<string, number | null>` on `readiness_contributors` made the wrong shape typecheck, so
compiler, tests and review all agreed with the cast while production rendered `[object Object]`.
**It was found by running the route on `pnpm dev` and reading the output** — the merge gate doing
exactly its job. Where two writers put different shapes in one column, take `unknown` and narrow.

## Shipped 2026-09-26

TN-83 (#1719, verdict multiplier → 1.00, owner-approved) · LA-148 (#1721, six medians → one
`packages/shared/src/stats.ts`) · RV-201 ① (#1726, computed health insight + LA-152 contributor
fix) · LA-151 ① (`acwr.ts`, in flight).

**Filed:** LA-151 (eight median copies remain; `hrv-5min.ts` deliberately excluded — it mirrors a
`torch.quantile` citation and is equivalent at q=0.5) · LA-152 (Reference: the two contributor
shapes) · plus a CI-evidence amendment on BF-61.

## Open, and not this lane's

- **BF-61's probe spec is red on `main`** (`e2e/food-log-swipe-delete.spec.ts:220`), from #1722. It
  failed on that PR's own run too. E2E is advisory so it merged, and it now fails on every lane's
  PR. Its failure **inverts BF-61's conclusion** — the entry says the web path passes at every
  delay; CI says otherwise. Recorded on BF-61; the next action there is a measurement, not a fix.
- **Owner-gated PRs exist — find them from the API, not from here.** Security, auth/session,
  secrets, data-dropping migrations and scoring calibration are confirm-first; merging auto-deploys
  to Railway.

## Owed to the owner

- **BF-13's re-derivation run.** `POST /api/admin/rederive-baselines`, `dryRun` by default, a
  production data write. All four `temperature-baseline` entries stay queued until it runs.
- **LA-112's effect size** — only `level` is persisted, never `dhrv`, so the magnitude could not be
  predicted.
- **LA-115** needs an APK and a Health Connect permission grant.
- **RV-201's health-insight change is user-visible**: the Health detail card now reads as a
  structured readout rather than coaching prose. Covered by his 2026-09-25 prefer-logic decision,
  but he has not seen it yet.

**LA-91 sits inside the original do-not-take band LA-84..LA-92.** Widened three times without the
owner asking. Do not widen it again.

## ⛔ A column rename is not available in this repo

Learned 2026-09-16 (LA-114). Migration Check replays every migration against a schema that already
has everything, and each `claude_ro` view migration regenerates the FULL view set, naming every
column. Rename one and a dozen historical migrations fail on replay; editing them is not available
because `ensureSchema` tracks by FILENAME. **A migration is not tested until applied TWICE to the
same database**: `CREATE DATABASE ci_replay` → `migrate.js` → `TRUNCATE schema_migrations` →
`migrate.js --replay`.

## Testing

- **Run the suite with `DATABASE_URL`** (`postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433`).
  Without it ~190 DB-backed files skip silently. Capture the real exit code into the log; piping to
  `tail` reports tail's.
- **The two `claude_ro` tests need a TCP URL** (`postgresql://postgres:postgres@localhost:5433/trainingai_dev`)
  and skip under the full suite. Run them directly for any migration adding a table or column —
  which also needs its regenerated twin in the SAME PR, a NEW number, diffed against the previous.
- **Mutation-test every change with at least one deliberately equivalent control.** Three survivors
  this session were real gaps: an absent label leaking into a readout, a silently-swallowed confirm
  error, and a calibration no behavioural test could see.
- **A test that passes under both the old and new behaviour pins nothing.** LA-151's median test
  used an odd-length fixture; TN-83's 33 behavioural tests passed at either multiplier. After
  fixing, re-apply the old behaviour and confirm the new test fails.
- **`docs/overview/entries/` has a 60-foldable-entry limit** enforced by Custom Rules, and merging
  `main` can tip you over it through no change of your own. `node scripts/fold-journal-entries.js
  --limit=10`, then `check-doc-links` and `check-index-doc-paths`.

## A red run with ZERO failing tests is not your change

- **`EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`** — now retried
  automatically in CI (`scripts/ci/vitest-retry-teardown-flake.js`).
- **`deadlock detected` in a migration test** — ONE failing test, not zero, which tells it apart.

## Gotchas

- **`pkill -f <pattern>` matches the shell running it** and kills this session with exit 144. Kill
  by PID. A killed suite also leaves fixture rows that fail the next run oddly — `git status`
  before staging after any interrupted run.
- **Prose in a backlog entry can be parsed as a field.** Writing "Not Lane A's to fix" inside a
  BF-61 bullet flipped its lane and broke the batch check. Diagnose by restoring `main`'s copy of
  the file and re-running.
- **A dependency written as a SENTENCE is invisible to the runner.** Read the entry for a prose
  dependency before starting; convert it to a `Needs:` field in that PR.
- **Never `git add -A` before resolving a conflict** — it hides the conflict from `git status`.
- **`git reset --hard` needs confirmation** per CLAUDE.md. Use `git checkout -B main origin/main`.
- On `docs/implementation-backlog.md` a conflict is usually TWO DELETIONS — keep neither. On
  append-only files keep both. Read the headings rather than assuming.
