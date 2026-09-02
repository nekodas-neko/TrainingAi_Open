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
- **Many suite runs in quick succession poison `rate_limits`, and the failure names another test.**
  The local DB persists `rate_limits` rows between runs, so a burst of runs inside one limit window
  makes routes the suite exercises start returning `Too many requests` — surfacing as an unrelated
  assertion like *expected 'Too many requests' to contain 'Invalid date'*, alongside
  `Hook timed out in 10000ms` from the pool contention riding with it. Measured 2026-08-12 during a
  seven-mutation verification pass: `DELETE FROM rate_limits` then re-run gave 448 files / 3,697
  tests green, **twice consecutively**. So it is load-dependent, not a repeat-run hazard — two
  back-to-back suite runs are fine. Clear the table before believing a failure of this shape.
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
The test user `test@local.dev` has password `testpass123` (seeded with a bcrypt
hash) for credentials-login testing.

