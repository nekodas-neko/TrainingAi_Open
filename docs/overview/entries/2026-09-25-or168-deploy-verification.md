# OR-168 — nothing confirmed a deploy landed, and the lag is now measured at 205s

**Branch:** `feat/or168-deploy-verification` · **Lane A** · `[platform]`

Merging to `main` auto-deploys to Railway and nothing checked the result. The 2026-08-17 outage — a
database-free route unreachable for ~8 minutes — was found by the owner noticing.

**Notify only, never act** (owner's decision, 2026-09-25): an automatic revert across a migration can
leave production worse than the bad deploy did. A check that tells you beats no check; a check that
*acts* is a mechanism that can itself fail.

## The entry's three warnings all held

- `/api/version`'s `version` is `CHANGELOG[0].version`, so it moves only when a PR bumps the
  changelog. Neither PR merged before this one did — polling it would have sat green against the
  previous deploy, exactly as warned.
- The route is `Cache-Control: public, max-age=300`, the single written exemption in
  `check-api-no-store.js`. The header stays; every poll busts it with a query param instead.
- `RAILWAY_GIT_COMMIT_SHA` is available at runtime — `app/sw.js/route.ts:12` already keys the
  service-worker cache on it.

## One thing the entry did not know, and it mattered twice

**The deployed commit was already observable before any code change**: `/sw.js` embeds
`` `ta-${BUILD_ID.slice(0, 12)}` `` in its cache name. Checked against production, it read
`ta-cdbc613d2596` — exactly `origin/main`'s head at the time.

That solved two problems the entry leaves open:

1. **The lag is no longer "not established".** Merging [#1663](https://github.com/nekodas-neko/TrainingAi_Open/pull/1663) and polling `/sw.js` every 20s timed the
   deploy at **205s**, ending on `ta-5b10e329671b` — the merge commit. The entry says to measure
   before choosing a timeout, "or the first false alarm teaches everyone to ignore the alarm".
2. **It breaks the bootstrap.** A poller keyed only on `webBuildSha` cannot verify the very deploy
   that introduces `webBuildSha` — it would time out against a production that has not got the
   field yet. Knowing `/sw.js` carries the same value means that case is diagnosable rather than
   mysterious, and the check says so in as many words.

## What shipped

`webBuildSha` on `/api/version`, and `scripts/check-deploy-landed.js` driven by a new
`deploy-check.yml` on `push: [main]`.

**The logic is a script, not shell inside the YAML**, so it has tests. **A separate workflow, not a
job in `ci.yml`**, because `ci.yml` deliberately has no `push: [main]` trigger — re-running the full
suite per merge costs ~11 billed minutes for a result the PR run already produced, and that decision
is not being reversed for a curl loop. **Not a required check**: it runs after the merge, so gating
on it would be circular.

**The deadline is 1200s against a measured 205s** — ~6x, not 2x. The measurement is a single
JS-only deploy; a merge that changes dependencies rebuilds more, and RV-188 has Railway builds near
a memory boundary. The two failure modes do not cost the same.

**The sha comparison is a prefix match in either direction**, because `sw.js` already truncates the
same value to 12 and nothing guarantees the field's length. With a floor of 7 characters — without
one, a short string prefix-matches every commit and the check passes against any deploy at all.

## Verification

31 tests. The three timeout diagnoses are separated deliberately: an app that does not answer, an
answer with no `webBuildSha`, and an answer still carrying the previous commit are different faults,
and collapsing them into "deploy failed" sends someone to Railway when the answer is an unset
environment variable.

| mutation | killed |
|---|---|
| drop `webBuildSha` from the route | 2 of 31 |
| `webBuildSha` falls back to `''` rather than null | 1 |
| `webBuildSha` reads the APK sha instead | 1 |
| drop the cache-bust from the polled url | 1 |
| `MIN_PREFIX` 7 → 1 | 1 |
| prefix match becomes strict equality | 2 |
| an unreachable app throws instead of polling on | 1 |
| **control:** reorder the two `startsWith` operands | **0 — survived, as intended** |

The poll loop was also run against real production before the field existed, which exercises the
bootstrap case: it correctly reported "answered but carries no webBuildSha", naming
`RAILWAY_GIT_COMMIT_SHA` as the thing to check.

Gates (real exit codes): `lint` 0 · `tsc` 0 · `typecheck:tests` 0 · `check:rules` 0 · pointers 0 ·
doc-size 0 · full suite green.

## Not exercised

**The workflow itself has never run**, and cannot before this merges — `push: [main]` is its only
trigger. Its first real execution is the merge that lands it, against a production that at that
moment still predates `webBuildSha`; it should go green once the deploy completes, on the same
~205s timescale. If it instead reports "carries no webBuildSha" at the deadline, that means
`RAILWAY_GIT_COMMIT_SHA` is unset on the Railway service, which no test here can tell us.

No migration, no local-store change, no device path, no APK.
