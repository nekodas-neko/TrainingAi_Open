# 2026-09-25 — OR-165: shard the tests, cache the Next build, and measure before culling anything

**Branch:** `perf/or-165-ci-shard-and-cache` · **Lane:** O · `ci.yml` and docs, no product code

An external contributor (jsboiss) said CI is too slow at ~8 minutes and proposed four fixes: cull the
10k tests, delete the Custom Rules job, gate jobs on changed files, and scope the build. The
instinct is right. Three of the four targets are not on the critical path.

## The measurement that decides it

Job durations across three runs, 2026-09-24/25:

| Job | Duration |
|---|---|
| Custom Rules | 26–37 s |
| E2E | 44 s (skips its expensive half) |
| Lint | 50–61 s |
| Migration Check | 57–66 s |
| Build | 3 m – 5 m 15 s |
| **Tests** | **6 m 42 s – 6 m 56 s** |

**They run in parallel, so wall clock is the slowest job — Tests, alone.** Everything but Build
finishes inside 70 seconds. Deleting Custom Rules saves **zero** wall clock. Gating Migration Check
on changed files saves **zero**. Both save runner minutes, which is a cost argument, not a speed one,
and should be made as such or it will look like it failed.

## What shipped

**Tests sharded four ways.** `vitest run --shard=i/4` over a matrix. Verified locally: shard 1 is
**264 of 1,055 files, 2,193 tests, 47 s** — a clean quarter.

**⚠ The aggregator job is load-bearing and the reason this could have been a disaster.** A matrix
reports `Tests (1)`, `Tests (2)`… and the `ProtectMain` ruleset — switched to Active hours earlier
today — requires a check named exactly `Tests`. Sharding without an aggregator means that check
**never reports**, which does not fail a PR: it leaves **every PR in the repository permanently
unmergeable**. A `test` job named `Tests`, `needs: test-shard`, `if: always()`, publishes the one
name. The `always()` matters as much as the job: without it a failed shard SKIPS the aggregator and
produces the same hang.

It is deliberately not guarded on `schedule`, because LB-31's nightly runs the suite and nothing
else, so this is the only job that can report its result.

**Every shard gets its own Postgres.** I had proposed segregating the ~20 DB-backed files into one
shard and changed my mind: shards are parallel, so four container starts cost nothing in wall clock,
and a database per shard means fewer files share one — which is the LA-32 collision class, reduced
rather than multiplied.

**`.next/cache` is now cached.** `cache: 'pnpm'` on setup-node caches the dependency store, not
Next's compilation output, so every CI build recompiled from cold — `pnpm build` is ~4 m 45 s of the
~5 m job while `pnpm install` is ~5 s. Keyed on lockfile + source with `restore-keys`, so a miss is
partial rather than total.

## What was refused, and why

**Culling tests.** The suite caught two real defects of mine in 24 hours, and the profile says the
cost is not assertions: `import 343 s` against `tests 517 s`. Sharding gets the same latency without
trading coverage for it.

**Deleting Custom Rules.** The premise — *"coding standards belong in CLAUDE.md, so you get it
free"* — is what this repo has the most evidence against. The cache-TTL check exists because prose
did not hold: one key carried two TTL expressions with different values. A component-level
`invalidateCache()` shipped through a green local gate (#1279). The duplicate-`Lane:`-field check
caught **me three times in one session** and I wrote the rule. CLAUDE.md is ~1,000 lines; "free"
assumes perfect recall by every agent every time.

**File-based gating of Tests.** Already used for E2E, and the mapping has been wrong twice — the
prefix list missed 47 browser-reachable files, and my replacement missed `instrumentation-client.ts`
and counted `import type` edges. **A conditional check that skips wrongly is worse than a slow one**,
because it reports green without running. Tests is where that mapping is hardest and the stakes are
highest.

**Moving the suite after the merge.** The usual advice, and impossible here: `main` auto-deploys to
Railway, so a red `main` is a broken production deploy. The pre-merge gate IS the production gate.

## Filed, not done

`OR-166` — `googleapis` installs **203 MB** for one `google.calendar()` call in one route. Lane A,
and it touches a working OAuth integration, so it gets a proper verification rather than a swap.

`OR-167` — `@phosphor-icons/react` (**41 MB**) is six files and five icons against `lucide-react`'s
270. Lane B, `Gate: owner`, because it changes icons on the screens he watches during a run.

## Verification

`pnpm check:rules` — Ran 78 of 78. `check-backlog-pointers` — OK, 498 entries. Workflow parsed with
PyYAML and asserted: a job named `Tests`, `needs: test-shard`, `if: always()`.

**The real proof is the PR itself** — a check named exactly `Tests` must appear, and the wall clock
should drop. Neither is established by reading the diff, and this must not merge until both are seen.
