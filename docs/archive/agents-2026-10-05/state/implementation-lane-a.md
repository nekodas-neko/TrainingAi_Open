# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. A
> renamed successor is a lost thread even with a perfect baton.

**Updated:** 2026-09-27 · **Next ID:** `LA-162`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.
`LA-54` was allocated and withdrawn, so it is used rather than free.)

**Schema numbers are no longer written down anywhere — run the command** (BF-211, shipped #1777):

```
node scripts/next-schema-number.js
```

It fetches, reads every ref, and reports the next free Postgres migration number, the next free
local SQLite version, and **which numbers an unmerged branch is holding**, named by branch and file.
`ls … | tail -1` cannot see a reservation. On 2026-09-27: migration **290**, SQLite **v44**, with
286/287 held by #1749, 288/289 by #1608, and v42 by #1749.

## Where things stand — read `docs/handoffs/handoff-2026-09-27-platform-lane-a-security-cluster.md`

**Five of Lane A's own PRs are open and owner-gated. Do not merge any of them.** Keep them rebased
and report, nothing more. Re-derive the list from the API rather than trusting these numbers —
the last baton carried a merged PR as live for six days.

| PR | entry | state |
|---|---|---|
| #1779 | RV-192 — an invite is not proof of the inbox | CI green |
| #1781 | RV-193 — the Google refresh token was browser-readable | CI green |
| #1784 | RV-195 ② — a deleted account stayed signed in | CI running when handed over |
| #1789 | RV-197 — `connect-src` allowed a WebSocket anywhere | CI running when handed over |

Plus, from earlier sessions: #1749 (LA-142, a `DROP COLUMN`), #1755 (OR-159 + RV-196, needs an APK),
#1672, #1671, #1499.

**Everything at the head of Lane A's READY list is that security cluster** — in one of those PRs, or
recorded as not-buildable-as-written. **The first genuinely new, non-gated item is `LA-138`.**

## Security items are BUILT, not skipped

`CLAUDE.md` requires confirmation before **merging** an auth/session/security change, not before
building one. Reading it the other way left the head of the queue inert for days (recorded on
#1755). Build it, verify it, open the PR, say plainly that it needs a yes, and move on.

## Required checks, and how to read CI

**Required: Lint · Tests (a gate over 4 shards) · Build · Custom Rules · Migration Check.**
**E2E is NOT required** — a PR merged with E2E red. Read it anyway; it is real information.

**The reliable green check is attempting the merge.** It validates against branch protection and
refuses with the reason. The run-level `status` lags 30+ minutes and has read `in_progress` on runs
whose jobs had all finished — read **job-level** conclusions. The cheapest read is
`get_job_logs` with `run_id` + `failed_only: true`: it answers `failed_jobs: 0` in one line, where
`list_workflow_jobs` returns every step of every job.

`main` merges every 10–20 minutes. Re-merge `origin/main` immediately before opening a PR **and**
again before merging. `total_count: 0` minutes after opening is a stale base, never slow CI.

## The local gate, in order — the middle step is the one that gets missed

```
npx tsc --noEmit
pnpm lint
pnpm build
node scripts/check-test-typecheck.js     # a SEPARATE Build-job step; `pnpm build` passing is not enough
pnpm check:rules                          # quote its "Ran N of N" — 83 on 2026-09-27
DATABASE_URL='postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433' \
  npx vitest run > /tmp/suite.log 2>&1; echo "EXIT=$?" >> /tmp/suite.log
```

Never pipe the suite to `tail` — that reports tail's exit code. **Run the suites for the code that
CONSUMES what you changed, not just the directory you edited**: that is exactly how TN-78's
regression reached CI.

## The pattern that decided nearly every item, again

**Six entries this session were right in their measurement and wrong in their conclusion.** Each
correction came from re-verifying against current code, never from re-reading the entry:

| entry | its claim | what was true |
|---|---|---|
| TN-78 | move `ZONE_DEFS`' Light floor to 0.4 | that map also builds run prescriptions — a recovery run's ceiling would drop 134 → 106 bpm. CI caught it. |
| TN-78 ② | "the goal will be met most days at 40 %" | met on 3 of 32 days. The prediction was inverted; the re-size it asked for was deliberately not filed. |
| BF-211 | the pointer row can reserve a number a branch holds | a CI check pinned it to `max(merged) + 1`. Measured: 292 against head 289 fails by name. |
| RV-193 | "the change is one line" | deleting it takes the token from the server too, and the replacement read has a silent-death trap. |
| RV-195 ① | `/mobile-signin` sets an httpOnly cookie | it is a **client** component. The shape that works costs an APK. |
| RV-195 ③ | return what the requester typed | not stored, and redaction must be viewer-aware. Needs a column. |

## Traps that cost time this session

- **`secureCookie` is the decryption salt.** Auth.js derives it from the cookie NAME, so a wrong
  value reads every valid token as invalid — a feature dies with a plain 401 and nothing in the
  logs. One convention, now shared by `lib/auth/session-token.ts`,
  `app/api/auth/exchange-mobile-token` and `lib/observability/request-error.ts`.
- **A stale remote-tracking ref lies convincingly** — one reported #1608 on migrations 284/285,
  numbers it had been renumbered off. `next-schema-number.js` fetches for that reason.
- **`git reset --soft HEAD~2` past a merge commit** throws the merge away. Reset to `origin/main`
  and commit once.
- **`pkill -f '<pattern>'` matches the shell running it** and exits 144. Kill by PID.
- **`pnpm start` cannot boot in the cloud container** — the instrumentation hook needs S3
  credentials (`SignatureDoesNotMatch (403)`). A local session can.
- **Version collisions are constant** (`main` took 1.477.8 → .13 in one session). Rebuild
  `changelog.ts` from `git show origin/main:packages/shared/src/changelog.ts` and prepend; never
  splice a conflict hunk.
- **Never carry a PR number as standing state** — re-derive open PRs from the API.

## Waiting on the owner

1. **RV-192, product:** build email verification (a provider, a secret, a token table, a screen), or
   **drop email-and-password registration entirely** — every current user signs in with Google, so
   the second closes it for nothing.
2. **RV-195 ①:** does binding the challenge to the browser defend anything, when a Chrome Custom Tab
   shares Chrome's cookie jar?
3. **A reply is owed to issue #1620's author (`jsboiss`)** and none was posted — commenting is
   confirm-first.
4. **TN-70** (`resilience_level`'s two disjoint regimes) and the bodyweight-plan question, from
   earlier sessions.
