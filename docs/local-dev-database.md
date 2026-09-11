# Local Development Database (Claude Code on the web)

Moved out of `CLAUDE.md` on 2026-09-02 to keep that file to what every session needs —
this is consulted when the local dev DB misbehaves, not on every session start. Nothing
changed in the move.


Sessions cannot reach the production Railway Postgres instance directly (its
proxy port is blocked by the sandbox network policy — only 80/443 are open).
Instead, a local Postgres 16 instance is set up automatically:

- `.claude/hooks/session-start.sh` runs `scripts/local-db/setup.sh` at the start
  of every remote session (only when `CLAUDE_CODE_REMOTE=true`).
- The script `initdb`s a cluster at `/var/lib/postgresql/local-dev` (if missing),
  starts it on port 5433, creates a `trainingai_dev` database, and applies all
  migrations from `lib/data/postgres/migrations/` via `scripts/local-db/migrate.js`.
- On first run only, it seeds fake data (`scripts/local-db/seed.sql`): one test
  user (`test@local.dev`), a Push/Pull/Legs program with a progression style and
  schedule, ~9 logged workout sessions, and 1-2 weeks of body metrics, sleep and
  mood data.
- It writes `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/trainingai_dev`
  to `.env.local`, which `next dev` picks up automatically.
- **The session-start hook exports a different, Unix-socket form** —
  `postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433`. Both reach the same
  database and either is fine for ordinary work, **but a test that re-points the URL at another
  Postgres role cannot do it over a socket**: rewriting the credentials leaves the connection as the
  superuser. `claude-ro-readonly-role.test.ts` is the one that does this, and under the socket URL
  it used to fail 20 of 21 tests at once — reading exactly like a broken read-only guarantee when it
  was a broken harness (cost a session on 2026-08-04; it now skips loudly instead). **If a DB test
  behaves differently under `pnpm test` than you expect, check which URL form is in your shell
  first.** Re-run role-sensitive suites with the TCP form above.
- Re-running `pnpm db:local` is safe — it's fully idempotent and won't re-seed if
  the `users` table is non-empty.
- **So a database left alone for days holds history that ends days ago** — the seed dates everything
  relative to the day it *ran* and nothing back-fills. A test asserting on "today" then fails locally
  and passes in CI, which provisions a fresh Postgres every run. **A red local run that is green in
  CI is at least as likely to be an aged fixture as a CI problem.** Check
  `SELECT max(date) FROM body_metrics WHERE steps IS NOT NULL` first, and re-seed by dropping
  `/var/lib/postgresql/local-dev` — `pnpm db:local` alone will not. (Cost Q-360, retired 2026-08-19:
  read as a literal-dates seed, which had been relative since the first commit.)
- **The Oura rollup tests were marginal by construction — fixed 2026-08-05, and the old advice is
  now narrower.** Those files (`oura-ble-*`, `oura-hrv-median-rollup`, `oura-illness-persist`,
  `sleep-oura-id-user-scope`) run a full `aggregateOuraRawSamples` pass. **Measured alone with zero
  contention they take 3.4 s to 14.6 s** against vitest's 5000 ms default — three of them sat within
  20% of the limit, so any parallel load tipped them over. That, not row collision, is what produced
  **four false alarms in one session on 2026-07-28**. They now run in a separate `rollup` vitest
  project with a 60 s timeout (`vitest.config.ts`); the other ~380 files stay at 5 s so a genuine
  hang still fails fast. **Keep the glob in step with
  `grep -rln 'aggregateOuraRawSamples(' --include='*.test.ts' .`** — a new rollup test outside it
  inherits the 5 s default and becomes the next false alarm.
- **Genuine pool exhaustion is still possible, and looks different.** All of
  `lib/data/postgres/__tests__/*` share one `trainingai_dev` instance; each vitest worker opens its
  own `pg` pool (`max: 10`, `lib/data/postgres/client.ts`) against `max_connections = 100`. A
  connection-acquisition failure — not a 5 s timeout — is that signature, and running a `pnpm dev`
  server at the same time makes it likelier, so stop it first. **A rollup test that times out now is
  worth believing** rather than re-running away.
- **Never run two full suites against the local DB at once — `migration-test-lock.test.ts` will fail, and it is right to.** Its `afterAll` asserts that no advisory lock is still held, so that the next file to take it does not hang. A second concurrent suite holds that lock, and the assertion fires as `expected 1 to be +0` in a file that has nothing to do with your change. Measured 2026-08-13: stacking runs produced exactly that, **1 test file failed with 0 failing tests** — the tell that it is a hook, not an assertion — and the file passed 3/3 alone seconds later with `pg_locks` empty. Check `SELECT count(*) FROM pg_locks WHERE locktype='advisory'` before believing it. Also: `pkill -f vitest` kills the background *monitors* watching the run too, and a killed run exits 143, which reads like a failure and is not.
- **A full run can exit 1 while reporting ZERO failing tests, from a worker teardown race. It is the third distinct cause of that shape in this file — check all three before believing a red (LA-101, measured 2026-09-10).** The whole failure is one line, with every test green above it:
  ```
  Vitest caught 1 unhandled error during the test run.
  EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending
  This error originated in "lib/__tests__/hr-read-routes.test.ts"
  ```
  A worker was torn down with a `console.*` forward still in flight. **Re-running is the correct response; every sighting has re-run clean on identical code.**
  **⚠ Amended 2026-09-11 — the file named in that message is the best lead there is, and this entry previously said the opposite.** It read *"the named file is not the culprit — it is whichever file that worker happened to be running"*, reasoning from vitest's own disclaimer (*"It doesn't mean the error was thrown inside the file itself"*). That disclaimer says the error was not THROWN there; it does not say the file is unrelated. **Three sightings, three times `lib/__tests__/hr-read-routes.test.ts`** — and the third fired **three times in one run**, all naming it. A file that is merely whichever one happened to be running would vary. Start there.
  **Why that file is a plausible culprit rather than a coincidence:** it exercises `/api/oura/hr-data`, whose durable-snapshot writes are deliberately **fire-and-forget** (`void repo.upsertWorkoutHrStats(…).catch(…)`, two of them). A promise the test never awaits can settle after the file finishes, and its `.catch` calls `reportServerError` — mocked in that suite, but the shape is exactly a late continuation running past teardown. Not proven: 24 controlled runs on 2026-09-10 could not reproduce the fault at all, so nothing has yet linked the dangling write to the RPC close. It is where to point a file-based trace first.
  **What has been ruled out, so nobody re-walks it:**
  - **Not reproducible on demand, but it is not rare either.** 24 controlled full runs on 2026-09-10 produced none — 8 with file-based console tracing, 8 plain, 4 with a `pnpm dev` server and 200 concurrent API requests against the same Postgres. Contention was the leading theory and did not survive that experiment. It then fired **three times in one run** on 2026-09-11, unprompted, during ordinary work. Whatever the trigger is, a controlled loop does not have it and an ordinary session does.
  - **Not the named file ALONE.** 5 solo runs of `hr-read-routes.test.ts` are clean, so it does not fail by itself — which is different from being uninvolved, per the amendment above.
  - **Not the `check-comment-blindness` interaction** (the first guess, from its unusually heavy console output): 3 paired runs, clean.
  - **Not fixable by upgrading.** 4.1.11 is the latest 4.1.x and no 4.2 exists.
  - **The run log cannot settle it, and this is the trap worth knowing.** The natural move is to grep the failing log for whatever logged last — e.g. `[pg pool] idle client error`, the one console writer that fires asynchronously outside any test's control. Its absence proves nothing: **the pending `onUserConsoleLog` IS the log that never got delivered**, so the message you are looking for is the one the failure destroys. Absence is guaranteed under every hypothesis. File-based tracing (append in a `console.*` wrapper, never through the RPC) is the only way to see it — that harness worked, it simply had nothing to catch.
  **Do not "fix" this by quieting console output or by setting `dangerouslyIgnoreUnhandledErrors`** — the first treats the symptom that is legible rather than the one that is broken, and the second hides real unhandled rejections too. `disableConsoleIntercept: true` would make `onUserConsoleLog` structurally impossible, and is the one candidate worth considering *if this ever becomes frequent* — it costs per-file log attribution for everyone, which is too high a price for a fault nobody can currently reproduce.
- **Killing a suite mid-run damages the NEXT run and, worse, the working tree — measured 2026-09-10 (LA-101).** Two distinct kinds of residue survive a `pkill`, and neither announces itself:
  1. **Fixture rows.** DB tests clean up in `afterEach`/`afterAll`, which a killed run never reaches. `program-session-tombstone.test.ts` left its `LB-66 Program` row behind, and the next full run failed with `UserFacingError: A program named "LB-66 Program" already exists` — an error that reads like a bug in the program-name guard and is really a corpse from the run you killed. It then **self-heals**, because that run's own `afterEach` clears the row, so it fails exactly once and looks like a flake.
  2. **Real source files.** `scripts/__tests__/check-comment-blindness.test.ts` injects fixtures into actual components (`components/workout/set-card.tsx`, `app/api/user/goals/route.ts`) and restores them in a `finally` the kill skips. The next run then reads the *polluted* file as its baseline and faithfully restores to that, so the injection is permanent and no later run will clean it. A `// <svg><polyline .../>` comment sat in `set-card.tsx` across eight clean full runs this way, one `git add -A` from being committed.
- **So after any killed run, `git status` before anything else** — and if `set-card.tsx` or `app/api/user/goals/route.ts` is modified and you did not modify it, `git checkout --` it. This is the concrete case behind CLAUDE.md's rule about never running `git add -A` when you did not expect the modified paths.
- **Many suite runs in quick succession poison `rate_limits`, and the failure names another test.**
  The local DB persists `rate_limits` rows between runs, so a burst of runs inside one limit window
  makes routes the suite exercises start returning `Too many requests` — surfacing as an unrelated
  assertion like *expected 'Too many requests' to contain 'Invalid date'*, alongside
  `Hook timed out in 10000ms` from the pool contention riding with it. Measured 2026-08-12 during a
  seven-mutation verification pass: `DELETE FROM rate_limits` then re-run gave 448 files / 3,697
  tests green, **twice consecutively**. So it is load-dependent, not a repeat-run hazard — two
  back-to-back suite runs are fine. Clear the table before believing a failure of this shape.
  **`DELETE FROM rate_limits` is not enough against a running `pnpm dev`, and that remedy misled a
  session on 2026-09-06.** The limiter is two-tier: the Postgres table is the shared store, but a
  synchronous in-memory L1 map holds the counts inside the server process and a `psql` delete does
  not touch it. The DB count is only written back into L1 after a background flush, so a bucket
  filled by a manual probe keeps refusing afterwards. Measured while verifying PS-25: with the table
  emptied, the correct password was still refused, which read exactly like a broken fix — and the
  same request signed in immediately after a `pnpm dev` restart. **Restart the dev server between
  runs that measure a rate limit.** For a suite run this does not arise, because each run is a fresh
  process.
- CI runs the suite on a clean database, so it is the better signal — but it is **not** infallible:
  on 2026-07-28 it went red on a genuine, deterministic failure that had nothing to do with the diff
  (see the hour-dependence rule in "Date Arithmetic"). A red CI on an unrelated change is worth one
  minute of checking before it is dismissed as noise.

- **To catch hour-dependent tests, run the suite under a faked clock:**
  `apt-get install -y faketime`, then
  `faketime '2026-07-28 14:10:00' env DATABASE_URL=... npx vitest run` (14:10 UTC = 00:10 Brisbane).
  **Caveat that will otherwise waste your time:** `faketime` shifts *node's* clock but not the
  already-running Postgres, so any DB-backed test mixing node time with the DB's `now()` fails
  spuriously once the skew exceeds its tolerance. `oura-battery-poll` is the known example — it
  documents a ±1h margin, and measured here it passes at a +10 min skew and fails at +3 h. That is
  the method misfiring, not a bug. The technique is sound for pure-logic and same-clock tests; a
  sweep at 00:10 and 04:00 Brisbane on 2026-07-28 found no hour-dependent tests beyond the one
  already fixed in #872.

Use this for any DB read/write testing during a session. To reset, drop
`/var/lib/postgresql/local-dev` and re-run `pnpm db:local`.

**Gotcha — pre-set `DATABASE_URL`/`DATABASE_SSL` env vars:** the container
provisions `DATABASE_URL` (pointing at production Railway) and `DATABASE_SSL=true`
as real process env vars. Next.js does **not** let `.env.local` override an
already-set `process.env` var, so `pnpm dev` will silently try to use the
production DB (and fail, since `DATABASE_SSL=true` makes `pg` require SSL,
which the local Postgres doesn't support) unless both are unset first. The
`session-start.sh` hook writes `unset DATABASE_URL` / `unset DATABASE_SSL` to
`$CLAUDE_ENV_FILE`, so a fresh shell in the session picks this up automatically.

**The consequence, which is a false green and was measured on 2026-09-09:** nothing in
`vitest.config.ts` or `vitest.setup.ts` loads `.env.local`, so with `DATABASE_URL` unset every
DB-backed file hits its `describe.skipIf(!canRun)` and **skips silently**. A bare `pnpm test` or
`pnpm ci:local` from a session shell therefore reports **678 passed / 191 skipped files (6,941
passed / 1,247 skipped tests)** and exits 0 — against **862 passed / 5 skipped files (8,098 passed /
86 skipped)** for the same tree with `DATABASE_URL` set, where four real failures surfaced. The
skipped count is the only tell, and it is easy to read past. **Always run the suite as
`DATABASE_URL=postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433 pnpm test`** (or
`env DATABASE_URL=… pnpm ci:local`) before calling a change tested; CI sets the variable, so a green
here that CI then fails is this gap, not flake.

**Second blind spot, same shape, found the same day: the socket URL disables the TCP-only tests.**
The value provisioned into `.env.local` and printed by the session-start hook is the **Unix-socket**
form, `postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433`. Three `claude_ro` files
and `lib/export/__tests__/db-snapshot-integration.test.ts` gate on `isTcpUrl(DATABASE_URL)` — they
provision a real read-only role, which needs a password login over TCP — so with the socket form
they **skip**, and the CI run executes 27 tests the local run never reaches. That is exactly how
LB-66 shipped a red `Tests` job past a green local suite: migration 271 added two columns and
`db-snapshot-integration.test.ts`'s drift check is what enforces regenerating the `claude_ro`
views, and it had skipped locally. **The same server also listens on `localhost:5433`, so use the
TCP form for any run you intend to trust:**

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/trainingai_dev pnpm test
```

**Corollary worth its own line: any migration that adds a column to a table with a `claude_ro` view
needs a regenerated view migration in the SAME PR** (`CLAUDE_RO_OWNER_USER_ID=<uuid> node
scripts/generate-claude-ro-views.js > lib/data/postgres/migrations/<next>_claude_ro_views_<reason>.sql`,
always a new number — `ensureSchema` tracks by filename). The generator emits an explicit column
list per view, so a new column is invisible to `/api/admin/db-query` until the views are rebuilt.
**Third blind spot, and this one is self-inflicted: applying a BRANCH's migration to the shared
local database poisons every later run in the session.** The database outlives the checkout. Apply a
migration that exists only on one branch, switch to another, and the schema no longer matches any
branch's code — so a full run reports failures that belong to neither.

Measured 2026-09-09. Q-44's table rename (migrations 273/274) was applied locally to verify it; a
later branch then ran the full suite and reported **7 failures across 4 files** — the export
manifest, the storage footprint, an index assertion and the `claude_ro` drift gate. None were that
branch's. All were code on `main` still naming tables the local database had renamed underneath it.

**The tell is the shape, not the count:** the branch's OWN tests passed (46/46) while unrelated
catalogue- and export-level tests failed. A failure set that avoids the thing you changed is
evidence about the environment, not the diff. Read it that way before debugging code that is fine —
the opposite reading costs a rework of working code, or a false "this branch is broken".

**Reverting needs an order.** The compatibility views were depended on by the `claude_ro` views, so
a straight reverse fails with `cannot drop view … because other objects depend on it`. The sequence
that works: `DROP SCHEMA claude_ro CASCADE`, reverse the renames, then re-apply the last
`claude_ro` migration on the branch you are returning to. Deriving the reverse by parsing the
migration file beats re-deriving it from the catalogue, which by then describes the renamed world.

The test user `test@local.dev` has password `testpass123` (seeded with a bcrypt
hash) for credentials-login testing.

